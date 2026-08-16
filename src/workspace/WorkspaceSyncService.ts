import * as vscode from 'vscode';
import * as path from 'path';
import { ILogger } from '../network/WebSocketClient';
import { CollaborationClient } from '../network/CollaborationClient';
import { FileCreatedMessage, FileChangedMessage, FileDeletedMessage, FileRenamedMessage, FileEditMessage, Message } from '../protocol/Message';
import { DocumentManager } from '../collaboration/document/DocumentManager';

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
    private readonly boundOnRemoteFileEdit: (msg: FileEditMessage) => void;
    
    // Lock event listeners
    private readonly boundOnLockGranted: (msg: Message) => void;
    private readonly boundOnLockDenied: (msg: Message) => void;
    private readonly boundOnUnlocked: (msg: Message) => void;

    private lockHeartbeatTimer: NodeJS.Timeout | null = null;
    private statusBarItem: vscode.StatusBarItem;
    
    private documentManager: DocumentManager;

    constructor(
        private readonly sessionId: string,
        private readonly collaborationClient: CollaborationClient,
        private readonly logger?: ILogger
    ) {
        this.boundOnRemoteFileCreated = this.onRemoteFileCreated.bind(this);
        this.boundOnRemoteFileChanged = this.onRemoteFileChanged.bind(this);
        this.boundOnRemoteFileDeleted = this.onRemoteFileDeleted.bind(this);
        this.boundOnRemoteFileRenamed = this.onRemoteFileRenamed.bind(this);
        this.boundOnRemoteFileEdit = this.onRemoteFileEdit.bind(this);
        
        this.boundOnLockGranted = this.onLockGranted.bind(this);
        this.boundOnLockDenied = this.onLockDenied.bind(this);
        this.boundOnUnlocked = this.onUnlocked.bind(this);

        const alignment = vscode.StatusBarAlignment ? vscode.StatusBarAlignment.Right : 2;
        this.statusBarItem = vscode.window.createStatusBarItem(alignment, 100);
        this.disposables.push(this.statusBarItem);
        
        this.documentManager = new DocumentManager(this.sessionId, this.collaborationClient);
        this.disposables.push(this.documentManager);
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

        this.disposables.push(this.watcher.onDidChange(async (uri) => {
            await this.handleLocalFileEvent(uri, rootPath, 'CHANGE');
        }));

        this.disposables.push(this.watcher.onDidDelete(async (uri) => {
            await this.handleLocalFileEvent(uri, rootPath, 'DELETE');
        }));

        // Removed manual onDidChangeTextDocument for FILE_EDIT - DocumentManager handles it now.

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
        this.collaborationClient.on('fileEdit', this.boundOnRemoteFileEdit);
        
        this.collaborationClient.on('fileLockGranted', this.boundOnLockGranted);
        this.collaborationClient.on('fileLockDenied', this.boundOnLockDenied);
        this.collaborationClient.on('fileUnlocked', this.boundOnUnlocked);

        // Active editor changes -> request lock - Disable rigid locking for now to allow collaborative edit
        // this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        //     this.handleActiveEditorChange(editor);
        // }));

        // Document closed -> release lock
        // this.disposables.push(vscode.workspace.onDidCloseTextDocument(doc => {
        //     if (doc.uri.scheme === 'file') {
        //         const relativePath = vscode.workspace.asRelativePath(doc.uri, false).replace(/\\/g, '/');
        //         this.collaborationClient.releaseFileLock(this.sessionId, relativePath);
        //     }
        // }));

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

    private handleActiveEditorChange(editor: vscode.TextEditor | undefined) {
        if (!editor || editor.document.uri.scheme !== 'file') {
            this.statusBarItem.hide();
            return;
        }

        const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');
        
        // Check current lock state
        const state = this.getFileState(relativePath);
        if (state.lockedByClientId && state.lockedByClientId !== this.collaborationClient.clientId) {
            this.statusBarItem.text = `$(lock) Locked by ${state.lockedByName}`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.show();
        } else {
            this.collaborationClient.requestFileLock(this.sessionId, relativePath);
            this.statusBarItem.hide();
        }
    }

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
            } else if (eventType === 'CHANGE') {
                this.log(`[INFO] Local file changed: ${relativePath}`);
                this.collaborationClient.sendFileChanged(this.sessionId, relativePath, content, baseRev, nextRev);
            }

        } catch (error) {
            this.log(`[ERROR] Failed to handle local file event ${eventType} for ${relativePath}: ${error}`);
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
        const { path: relativePath, revision } = message.payload;
        const state = this.getFileState(relativePath);
        if (revision > state.revision) {
            state.revision = revision;
            state.exists = true;
            await this.applyRemoteFileEvent(relativePath, message.payload.content, 'CHANGE');
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

    private async onRemoteFileEdit(message: FileEditMessage): Promise<void> {
        // Obsolete: Handled by DocumentManager and Yjs now.
        // We leave this to avoid breaking if an old message arrives, but we don't process it.
        this.log(`[SYNC DEBUG] IGNORING LEGACY REMOTE EDIT\n[SYNC DEBUG] path=${message.payload.path}`);
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
            // Attempt to acquire lock again
            this.collaborationClient.requestFileLock(this.sessionId, payload.path);
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
        this.collaborationClient.removeListener('fileEdit', this.boundOnRemoteFileEdit);
    }
}
