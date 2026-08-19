import * as vscode from 'vscode';
import * as path from 'path';
import { ILogger } from '../network/WebSocketClient';
import { CollaborationClient } from '../network/CollaborationClient';
import { FileCreatedMessage, FileChangedMessage, FileDeletedMessage, FileRenamedMessage, FileEditMessage, Message, SaveRejectedMessage } from '../protocol/Message';

interface LocalFileState {
    revision: number;
    exists: boolean;
    lockedByClientId?: string;
    lockedByName?: string;
}

export class WorkspaceSyncService {
    private readonly MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
    private watcher: vscode.FileSystemWatcher | null = null;
    private applyingRemoteChanges = new Set<string>();
    private disposables: vscode.Disposable[] = [];

    // Local file revision tracking
    private fileStates = new Map<string, LocalFileState>();

    // Debouncing/batching for edits
    private editTimers = new Map<string, NodeJS.Timeout>();
    private pendingEdits = new Map<string, Array<{range: {start: {line: number, character: number}, end: {line: number, character: number}}, text: string}>>();
    private readonly EDIT_DEBOUNCE_MS = 50;

    // Bound listeners for easy removal
    private readonly boundOnRemoteFileCreated: (msg: FileCreatedMessage) => void;
    private readonly boundOnRemoteFileChanged: (msg: FileChangedMessage) => void;
    private readonly boundOnRemoteFileDeleted: (msg: FileDeletedMessage) => void;
    private readonly boundOnRemoteFileRenamed: (msg: FileRenamedMessage) => void;
    private readonly boundOnSaveRejected: (msg: SaveRejectedMessage) => void;
    
    // Lock event listeners
    private readonly boundOnLockGranted: (msg: Message) => void;
    private readonly boundOnLockDenied: (msg: Message) => void;
    private readonly boundOnUnlocked: (msg: Message) => void;
    private readonly boundOnDocumentLocked: (msg: Message) => void;

    private lockHeartbeatTimer: NodeJS.Timeout | null = null;
    private statusBarItem: vscode.StatusBarItem;

    constructor(
        private readonly sessionId: string,
        private readonly collaborationClient: CollaborationClient,
        private readonly logger?: ILogger
    ) {
        this.boundOnRemoteFileCreated = this.onRemoteFileCreated.bind(this);
        this.boundOnRemoteFileChanged = this.onRemoteFileChanged.bind(this);
        this.boundOnRemoteFileDeleted = this.onRemoteFileDeleted.bind(this);
        this.boundOnRemoteFileRenamed = this.onRemoteFileRenamed.bind(this);
        this.boundOnSaveRejected = this.onSaveRejected.bind(this);
        
        this.boundOnLockGranted = this.onLockGranted.bind(this);
        this.boundOnLockDenied = this.onLockDenied.bind(this);
        this.boundOnUnlocked = this.onUnlocked.bind(this);
        this.boundOnDocumentLocked = this.onDocumentLocked.bind(this);

        const alignment = vscode.StatusBarAlignment ? vscode.StatusBarAlignment.Right : 2;
        this.statusBarItem = vscode.window.createStatusBarItem(alignment, 100);
        this.disposables.push(this.statusBarItem);
    }

    private log(message: string): void {
        if (this.logger) {
            this.logger.log(message);
        } else {
            console.log(message);
        }
    }

    public start(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.log('[WARN] Cannot start WorkspaceSyncService: No workspace folder open.');
            return;
        }

        const rootUri = workspaceFolders[0].uri;
        const rootPath = rootUri.fsPath;

        // Watch everything, we'll filter dynamically
        this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        this.disposables.push(this.watcher.onDidCreate(async (uri) => {
            await this.handleLocalFileEvent(uri, rootPath, 'CREATE');
        }));

        this.disposables.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.uri.scheme === 'file') {
                await this.handleLocalFileSaved(document.uri);
            }
        }));

        this.disposables.push(this.watcher.onDidDelete(async (uri) => {
            await this.handleLocalFileEvent(uri, rootPath, 'DELETE');
        }));

        this.disposables.push(vscode.workspace.onDidChangeTextDocument(async (event) => {
            if (event.document.uri.scheme !== 'file') return;
            const relativePath = vscode.workspace.asRelativePath(event.document.uri, false).replace(/\\/g, '/');
            
            // Ignore if we are applying remote changes
            if (this.applyingRemoteChanges.has(relativePath)) return;
            
            // Check if this document is actually the active one being typed in.
            // If it's a background update (e.g., delayed fs.writeFile from remote sync), we MUST NOT trigger an undo, 
            // as executeCommand('undo') applies to the active editor globally, which causes the workspace-read-only bug!
            const activeEditor = vscode.window.activeTextEditor;
            const isActiveDocument = activeEditor && activeEditor.document.uri.toString() === event.document.uri.toString();
            
            const state = this.getFileState(relativePath);
            
            if (state.lockedByClientId && state.lockedByClientId !== this.collaborationClient.clientId) {
                if (isActiveDocument) {
                    // Someone else owns the lock and the user is typing here! Block edit by undoing immediately.
                    vscode.commands.executeCommand('undo');
                    vscode.window.showWarningMessage(`🔒 ${state.lockedByName} is currently editing this file. You can view and run this file, but editing is temporarily locked.`);
                } else {
                    // It's a background change (e.g., remote sync completing). Do nothing.
                    this.log(`[DEBUG] Ignoring background change on locked file: ${relativePath}`);
                }
            } else if (!state.lockedByClientId && isActiveDocument) {
                // Not locked, and user is typing in it. Request lock!
                this.collaborationClient.requestFileLock(this.sessionId, relativePath);
            }
        }));

        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            const currentActivePath = editor && editor.document.uri.scheme === 'file' 
                ? vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/')
                : undefined;
            
            // Release locks for any files we own that are no longer the active editor
            for (const [relativePath, state] of this.fileStates.entries()) {
                if (state.lockedByClientId === this.collaborationClient.clientId && relativePath !== currentActivePath) {
                    this.collaborationClient.releaseFileLock(this.sessionId, relativePath);
                }
            }

            if (currentActivePath) {
                const state = this.getFileState(currentActivePath);
                
                // Request lock for the newly active file if not already locked
                if (!state.lockedByClientId) {
                    this.collaborationClient.requestFileLock(this.sessionId, currentActivePath);
                }

                if (state.lockedByClientId && state.lockedByClientId !== this.collaborationClient.clientId) {
                    this.statusBarItem.text = `$(lock) ${state.lockedByName} is editing this file`;
                    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                    this.statusBarItem.show();
                } else if (!state.lockedByClientId) {
                    this.statusBarItem.text = `$(circle-filled) ${path.basename(currentActivePath)} available`;
                    this.statusBarItem.backgroundColor = undefined;
                    this.statusBarItem.show();
                } else {
                    this.statusBarItem.text = `$(edit) You are editing ${path.basename(currentActivePath)}`;
                    this.statusBarItem.backgroundColor = undefined;
                    this.statusBarItem.show();
                }
            } else {
                this.statusBarItem.hide();
            }
        }));

        this.disposables.push(vscode.workspace.onDidRenameFiles(async (event) => {
            for (const file of event.files) {
                await this.handleLocalFileRenamed(file.oldUri, file.newUri, rootPath);
            }
        }));

        // Listen for remote events from the collaboration client
        this.collaborationClient.on('fileCreated', this.boundOnRemoteFileCreated);
        this.collaborationClient.on('fileChanged', this.boundOnRemoteFileChanged);
        this.collaborationClient.on('fileDeleted', this.boundOnRemoteFileDeleted);
        this.collaborationClient.on('fileRenamed', this.boundOnRemoteFileRenamed);
        this.collaborationClient.on('saveRejected', this.boundOnSaveRejected);
        
        this.collaborationClient.on('fileLockGranted', this.boundOnLockGranted);
        this.collaborationClient.on('fileLockDenied', this.boundOnLockDenied);
        this.collaborationClient.on('fileUnlocked', this.boundOnUnlocked);
        this.collaborationClient.on('documentLocked', this.boundOnDocumentLocked);

        // Active editor changes -> request lock - Disable rigid locking for now to allow collaborative edit
        // this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        //     this.handleActiveEditorChange(editor);
        // }));

        // Document closed -> release lock
        this.disposables.push(vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc.uri.scheme === 'file') {
                const relativePath = vscode.workspace.asRelativePath(doc.uri, false).replace(/\\/g, '/');
                const state = this.getFileState(relativePath);
                if (state.lockedByClientId === this.collaborationClient.clientId) {
                    this.collaborationClient.releaseFileLock(this.sessionId, relativePath);
                }
            }
        }));

        this.startLockHeartbeat();

        this.log('[INFO] WorkspaceSyncService started.');
    }

    public initializeRevisions(snapshotRevision: number, paths: string[]): void {
        for (const path of paths) {
            const relativePath = path.replace(/\\/g, '/');
            this.fileStates.set(relativePath, {
                revision: snapshotRevision,
                exists: true
            });
        }
        this.log(`[INFO] Initialized revisions to ${snapshotRevision} for ${paths.length} files`);
    }

    private getFileState(relativePath: string): LocalFileState {
        let state = this.fileStates.get(relativePath);
        if (!state) {
            state = { revision: 0, exists: true };
            this.fileStates.set(relativePath, state);
        }
        return state;
    }

    private startLockHeartbeat() {
        this.lockHeartbeatTimer = setInterval(() => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.scheme === 'file') {
                const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');
                const state = this.getFileState(relativePath);
                if (state.lockedByClientId === this.collaborationClient.clientId) {
                    this.collaborationClient.sendFileLockHeartbeat(this.sessionId, relativePath);
                }
            }
        }, 10000);
    }

    // handleActiveEditorChange is removed

    private async handleLocalFileRenamed(oldUri: vscode.Uri, newUri: vscode.Uri, rootPath: string): Promise<void> {
        const oldRelativePath = vscode.workspace.asRelativePath(oldUri, false).replace(/\\/g, '/');
        const newRelativePath = vscode.workspace.asRelativePath(newUri, false).replace(/\\/g, '/');

        if (oldRelativePath.includes('.git/') || oldRelativePath.includes('node_modules/') || oldRelativePath.includes('.vscode/') ||
            newRelativePath.includes('.git/') || newRelativePath.includes('node_modules/') || newRelativePath.includes('.vscode/')) {
            return;
        }

        if (this.applyingRemoteChanges.has(oldRelativePath) || this.applyingRemoteChanges.has(newRelativePath)) {
            this.log(`[DEBUG] Ignoring local RENAME event for ${oldRelativePath} -> ${newRelativePath} (remote apply guard active)`);
            return;
        }

        this.log(`[INFO] Local file renamed: ${oldRelativePath} -> ${newRelativePath}`);
        const state = this.getFileState(oldRelativePath);
        const baseRev = state.revision;
        const nextRev = baseRev + 1;
        state.revision = nextRev;
        this.collaborationClient.sendFileRenamed(this.sessionId, oldRelativePath, newRelativePath, baseRev, nextRev);
    }

    private async handleLocalFileEvent(uri: vscode.Uri, rootPath: string, eventType: 'CREATE' | 'CHANGE' | 'DELETE'): Promise<void> {
        const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');

        // Ignore excluded folders
        if (relativePath.includes('.git/') || relativePath.includes('node_modules/') || relativePath.includes('.vscode/')) {
            return;
        }

        if (this.applyingRemoteChanges.has(relativePath)) {
            this.log(`[DEBUG] Ignoring local ${eventType} event for ${relativePath} (remote apply guard active)`);
            return;
        }

        try {
            if (eventType === 'DELETE') {
                this.log(`[INFO] Local file deleted: ${relativePath}`);
                const state = this.getFileState(relativePath);
                const nextRev = state.revision + 1;
                state.revision = nextRev;
                state.exists = false;
                this.collaborationClient.sendFileDeleted(this.sessionId, relativePath, state.revision, nextRev);
                return;
            }

            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type !== vscode.FileType.File) {
                return; // Only sync files
            }

            if (stat.size > this.MAX_FILE_SIZE) {
                this.log(`[INFO] Skipping local file sync: ${relativePath} (too large)`);
                return;
            }

            const contentArray = await vscode.workspace.fs.readFile(uri);
            if (this.isLikelyBinary(uri.fsPath, contentArray)) {
                this.log(`[INFO] Skipping local file sync: ${relativePath} (binary)`);
                return;
            }

            const content = new TextDecoder('utf-8').decode(contentArray);

            const state = this.getFileState(relativePath);
            const baseRev = state.revision;
            const nextRev = baseRev + 1;
            state.revision = nextRev;

            if (eventType === 'CREATE') {
                this.log(`[INFO] Local file created: ${relativePath}`);
                state.exists = true;
                this.collaborationClient.sendFileCreated(this.sessionId, relativePath, content, baseRev, nextRev);
            }

        } catch (error) {
            this.log(`[ERROR] Failed to handle local file event ${eventType} for ${relativePath}: ${error}`);
        }
    }

    private async handleLocalFileSaved(uri: vscode.Uri): Promise<void> {
        const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');

        if (relativePath.includes('.git/') || relativePath.includes('node_modules/') || relativePath.includes('.vscode/')) {
            return;
        }

        if (this.applyingRemoteChanges.has(relativePath)) {
            this.log(`[DEBUG] Ignoring local SAVE event for ${relativePath} (remote apply guard active)`);
            return;
        }

        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type !== vscode.FileType.File || stat.size > this.MAX_FILE_SIZE) {
                return;
            }

            const contentArray = await vscode.workspace.fs.readFile(uri);
            if (this.isLikelyBinary(uri.fsPath, contentArray)) {
                return;
            }

            const content = new TextDecoder('utf-8').decode(contentArray);
            const state = this.getFileState(relativePath);
            
            this.log(`[INFO] Local file saved, requesting SAVE_DOCUMENT: ${relativePath} (baseRevision: ${state.revision})`);
            this.collaborationClient.sendSaveDocument(this.sessionId, relativePath, state.revision, content);
        } catch (error) {
            this.log(`[ERROR] Failed to handle local file save for ${relativePath}: ${error}`);
        }
    }

    private async onRemoteFileCreated(message: FileCreatedMessage): Promise<void> {
        const { path: relativePath, revision } = message.payload;
        const state = this.getFileState(relativePath);
        if (revision > state.revision) {
            state.revision = revision;
            state.exists = true;
            await this.applyRemoteFileEvent(relativePath, message.payload.content, 'CREATE');
        }
    }

    private async onRemoteFileChanged(message: FileChangedMessage): Promise<void> {
        this.log(`[TRACE 9] REMOTE FILE_CHANGED HANDLER\npath=${message.payload.path}\ncontentLength=${message.payload.content.length}`);
        const { path: relativePath, revision, clientId } = message.payload;
        const state = this.getFileState(relativePath);

        // Track if this client was the one who sent the save
        const isOwnSave = clientId === this.sessionId;

        if (revision > state.revision) {
            state.revision = revision;
            state.exists = true;
            await this.applyRemoteFileEvent(relativePath, message.payload.content, 'CHANGE');
            
            if (isOwnSave) {
                vscode.window.showInformationMessage("✓ Changes saved and shared with collaborators.");
            } else {
                vscode.window.showInformationMessage("Collaborative version updated.");
            }
        }
    }

    private async onRemoteFileDeleted(message: FileDeletedMessage): Promise<void> {
        const { path: relativePath, revision } = message.payload;
        const state = this.getFileState(relativePath);
        
        if (revision > state.revision) {
            state.revision = revision;
            state.exists = false;

            // Close active editor if open
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document.uri.scheme === 'file') {
                    const editorPath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');
                    if (editorPath === relativePath) {
                        vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    }
                }
            }

            await this.applyRemoteFileEvent(relativePath, undefined, 'DELETE');
        }
    }

    private async onSaveRejected(message: SaveRejectedMessage): Promise<void> {
        const { path: relativePath, currentRevision, currentContent } = message.payload;
        this.log(`[INFO] Save rejected for ${relativePath}, server revision is ${currentRevision}. Pulling latest...`);
        
        vscode.window.showWarningMessage("Another collaborator saved first. Their version is now active.");
        
        const state = this.getFileState(relativePath);
        state.revision = currentRevision;
        state.exists = true;
        await this.applyRemoteFileEvent(relativePath, currentContent, 'CHANGE');
    }

    private onLockGranted(message: Message): void {
        const payload = message.payload as any;
        const state = this.getFileState(payload.path);
        state.lockedByClientId = payload.ownerClientId;
        state.lockedByName = payload.ownerName;
        
        const editor = vscode.window.activeTextEditor;
        if (editor && vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/') === payload.path) {
            this.statusBarItem.hide();
        }
    }

    private onLockDenied(message: Message): void {
        const payload = message.payload as any;
        const state = this.getFileState(payload.path);
        state.lockedByClientId = payload.ownerClientId;
        state.lockedByName = payload.ownerName;

        const editor = vscode.window.activeTextEditor;
        if (editor && vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/') === payload.path) {
            this.statusBarItem.text = `$(lock) Locked by ${payload.ownerName}`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.show();
        }
    }

    private onUnlocked(message: Message): void {
        const payload = message.payload as any;
        const state = this.getFileState(payload.path);
        state.lockedByClientId = undefined;
        state.lockedByName = undefined;

        const editor = vscode.window.activeTextEditor;
        if (editor && vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/') === payload.path) {
            this.statusBarItem.text = `$(circle-filled) ${path.basename(payload.path)} available`;
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.show();
        }
    }

    private onDocumentLocked(message: Message): void {
        const payload = message.payload as any;
        const state = this.getFileState(payload.documentId);
        state.lockedByClientId = payload.ownerClientId;
        state.lockedByName = payload.ownerName;

        const editor = vscode.window.activeTextEditor;
        if (editor && vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/') === payload.documentId) {
            this.statusBarItem.text = `$(lock) ${payload.ownerName} is editing this file`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.show();
            vscode.window.showWarningMessage(`🔒 ${payload.ownerName} is currently editing this file. Save rejected.`);
        }
    }

    private async onRemoteFileRenamed(message: FileRenamedMessage): Promise<void> {
        await this.applyRemoteFileRenamed(message.payload.oldPath, message.payload.newPath);
    }

    private async applyRemoteFileRenamed(oldPath: string, newPath: string): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        if (oldPath.startsWith('/') || oldPath.includes('../') || oldPath === '..' ||
            newPath.startsWith('/') || newPath.includes('../') || newPath === '..') {
            this.log(`[WARN] Skipping unsafe remote rename paths: ${oldPath} -> ${newPath}`);
            return;
        }

        const rootUri = workspaceFolders[0].uri;
        const oldUri = vscode.Uri.joinPath(rootUri, ...oldPath.split('/'));
        const newUri = vscode.Uri.joinPath(rootUri, ...newPath.split('/'));

        this.applyingRemoteChanges.add(oldPath);
        this.applyingRemoteChanges.add(newPath);

        try {
            this.log(`[INFO] Applying remote RENAME: ${oldPath} -> ${newPath}`);
            
            const parentParts = newPath.split('/');
            parentParts.pop();
            
            if (parentParts.length > 0) {
                const parentUri = vscode.Uri.joinPath(rootUri, ...parentParts);
                await vscode.workspace.fs.createDirectory(parentUri);
            }

            await vscode.workspace.fs.rename(oldUri, newUri, { overwrite: true });
        } catch (error) {
            this.log(`[ERROR] Failed to apply remote RENAME ${oldPath} -> ${newPath}: ${error}`);
        } finally {
            setTimeout(() => {
                this.applyingRemoteChanges.delete(oldPath);
                this.applyingRemoteChanges.delete(newPath);
            }, 100);
        }
    }

    private async applyRemoteFileEvent(relativePath: string, content: string | undefined, eventType: 'CREATE' | 'CHANGE' | 'DELETE'): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }
        
        // Prevent path traversal
        if (relativePath.startsWith('/') || relativePath.includes('../') || relativePath === '..') {
            this.log(`[WARN] Skipping unsafe remote sync path: ${relativePath}`);
            return;
        }

        const rootUri = workspaceFolders[0].uri;
        const fileUri = vscode.Uri.joinPath(rootUri, ...relativePath.split('/'));

        this.applyingRemoteChanges.add(relativePath);

        try {
            if (eventType === 'DELETE') {
                this.log(`[INFO] Applying remote DELETE: ${relativePath}`);
                try {
                    await vscode.workspace.fs.delete(fileUri, { useTrash: false });
                } catch (e) {
                    this.log(`[WARN] Failed to delete file (might not exist): ${relativePath}`);
                }
            } else {
                this.log(`[INFO] Applying remote ${eventType}: ${relativePath}`);
                if (eventType === 'CHANGE') {
                    this.log(`[TRACE 10] APPLY REMOTE CONTENT\npath=${relativePath}\ncontentLength=${content?.length ?? 0}`);
                }
                
                const parentParts = relativePath.split('/');
                parentParts.pop();
                
                if (parentParts.length > 0) {
                    const parentUri = vscode.Uri.joinPath(rootUri, ...parentParts);
                    await vscode.workspace.fs.createDirectory(parentUri);
                }

                if (content !== undefined) {
                    let wasAppliedToOpenEditor = false;

                    // Avoid "Save + Overwrite" prompt by applying to open editor if available
                    for (const editor of vscode.window.visibleTextEditors) {
                        if (editor.document.uri.scheme === 'file') {
                            const editorPath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');
                            if (editorPath === relativePath) {
                                const edit = new vscode.WorkspaceEdit();
                                const fullRange = new vscode.Range(
                                    editor.document.positionAt(0),
                                    editor.document.positionAt(editor.document.getText().length)
                                );
                                edit.replace(editor.document.uri, fullRange, content);
                                await vscode.workspace.applyEdit(edit);
                                wasAppliedToOpenEditor = true;
                                break;
                            }
                        }
                    }

                    if (!wasAppliedToOpenEditor) {
                        const encodedContent = new TextEncoder().encode(content);
                        await vscode.workspace.fs.writeFile(fileUri, encodedContent);
                    }

                    if (eventType === 'CHANGE') {
                        this.log(`[TRACE 10A] APPLY EDIT RESULT\nsuccess=true\nwasAppliedToOpenEditor=${wasAppliedToOpenEditor}`);
                    }
                }
            }
        } catch (error) {
            if (eventType === 'CHANGE') {
                this.log(`[TRACE 10A] APPLY EDIT RESULT\nsuccess=false\nerror=${error}`);
            }
            this.log(`[ERROR] Failed to apply remote ${eventType} for ${relativePath}: ${error}`);
        } finally {
            // Leave it in the set briefly to ignore the watcher event that will fire
            setTimeout(() => {
                this.applyingRemoteChanges.delete(relativePath);
            }, 100);
        }
    }

    /**
     * Adds a remote-apply guard for the given relative path.
     * While the guard is active, local file system events for this path
     * will be ignored and NOT sent to the server.
     * Use this to prevent snapshot application from triggering outbound sync messages.
     */
    public addRemoteApplyGuard(relativePath: string): void {
        this.applyingRemoteChanges.add(relativePath);
    }

    /**
     * Removes the remote-apply guard for the given relative path.
     */
    public removeRemoteApplyGuard(relativePath: string): void {
        this.applyingRemoteChanges.delete(relativePath);
    }

    private isLikelyBinary(filePath: string, content: Uint8Array): boolean {
        const ext = path.extname(filePath).toLowerCase();
        const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.exe', '.dll', '.zip', '.tar', '.gz'];
        if (binaryExtensions.includes(ext)) {
            return true;
        }
        const limit = Math.min(100, content.length);
        for (let i = 0; i < limit; i++) {
            if (content[i] === 0) {
                return true;
            }
        }
        return false;
    }

    public dispose(): void {
        this.log('[INFO] Disposing WorkspaceSyncService...');
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = null;
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
        
        this.collaborationClient.removeListener('fileCreated', this.boundOnRemoteFileCreated);
        this.collaborationClient.removeListener('fileChanged', this.boundOnRemoteFileChanged);
        this.collaborationClient.removeListener('fileDeleted', this.boundOnRemoteFileDeleted);
        this.collaborationClient.removeListener('fileRenamed', this.boundOnRemoteFileRenamed);
        this.collaborationClient.removeListener('saveRejected', this.boundOnSaveRejected);
        this.collaborationClient.removeListener('documentLocked', this.boundOnDocumentLocked);
    }
}
