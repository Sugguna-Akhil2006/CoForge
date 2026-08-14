import * as vscode from 'vscode';
import * as path from 'path';
import { ILogger } from '../network/WebSocketClient';
import { CollaborationClient } from '../network/CollaborationClient';
import { FileCreatedMessage, FileChangedMessage, FileDeletedMessage, FileRenamedMessage } from '../protocol/Message';

export class WorkspaceSyncService {
    private readonly MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
    private watcher: vscode.FileSystemWatcher | null = null;
    private applyingRemoteChanges = new Set<string>();
    private disposables: vscode.Disposable[] = [];

    // Bound listeners for easy removal
    private readonly boundOnRemoteFileCreated: (msg: FileCreatedMessage) => void;
    private readonly boundOnRemoteFileChanged: (msg: FileChangedMessage) => void;
    private readonly boundOnRemoteFileDeleted: (msg: FileDeletedMessage) => void;
    private readonly boundOnRemoteFileRenamed: (msg: FileRenamedMessage) => void;

    constructor(
        private readonly sessionId: string,
        private readonly collaborationClient: CollaborationClient,
        private readonly logger?: ILogger
    ) {
        this.boundOnRemoteFileCreated = this.onRemoteFileCreated.bind(this);
        this.boundOnRemoteFileChanged = this.onRemoteFileChanged.bind(this);
        this.boundOnRemoteFileDeleted = this.onRemoteFileDeleted.bind(this);
        this.boundOnRemoteFileRenamed = this.onRemoteFileRenamed.bind(this);
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

        this.log('[INFO] WorkspaceSyncService started.');
    }

    private async handleLocalFileRenamed(oldUri: vscode.Uri, newUri: vscode.Uri, rootPath: string): Promise<void> {
        const oldRelativePath = path.relative(rootPath, oldUri.fsPath).replace(/\\/g, '/');
        const newRelativePath = path.relative(rootPath, newUri.fsPath).replace(/\\/g, '/');

        if (oldRelativePath.includes('.git/') || oldRelativePath.includes('node_modules/') || oldRelativePath.includes('.vscode/') ||
            newRelativePath.includes('.git/') || newRelativePath.includes('node_modules/') || newRelativePath.includes('.vscode/')) {
            return;
        }

        if (this.applyingRemoteChanges.has(oldRelativePath) || this.applyingRemoteChanges.has(newRelativePath)) {
            this.log(`[DEBUG] Ignoring local RENAME event for ${oldRelativePath} -> ${newRelativePath} (remote apply guard active)`);
            return;
        }

        this.log(`[INFO] Local file renamed: ${oldRelativePath} -> ${newRelativePath}`);
        this.collaborationClient.sendFileRenamed(this.sessionId, oldRelativePath, newRelativePath);
    }

    private async handleLocalFileEvent(uri: vscode.Uri, rootPath: string, eventType: 'CREATE' | 'CHANGE' | 'DELETE'): Promise<void> {
        const relativePath = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');

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
                this.collaborationClient.sendFileDeleted(this.sessionId, relativePath);
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

            if (eventType === 'CREATE') {
                this.log(`[INFO] Local file created: ${relativePath}`);
                this.collaborationClient.sendFileCreated(this.sessionId, relativePath, content);
            } else if (eventType === 'CHANGE') {
                this.log(`[INFO] Local file changed: ${relativePath}`);
                this.collaborationClient.sendFileChanged(this.sessionId, relativePath, content);
            }

        } catch (error) {
            this.log(`[ERROR] Failed to handle local file event ${eventType} for ${relativePath}: ${error}`);
        }
    }

    private async onRemoteFileCreated(message: FileCreatedMessage): Promise<void> {
        await this.applyRemoteFileEvent(message.payload.path, message.payload.content, 'CREATE');
    }

    private async onRemoteFileChanged(message: FileChangedMessage): Promise<void> {
        await this.applyRemoteFileEvent(message.payload.path, message.payload.content, 'CHANGE');
    }

    private async onRemoteFileDeleted(message: FileDeletedMessage): Promise<void> {
        await this.applyRemoteFileEvent(message.payload.path, undefined, 'DELETE');
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
                
                const parentParts = relativePath.split('/');
                parentParts.pop();
                
                if (parentParts.length > 0) {
                    const parentUri = vscode.Uri.joinPath(rootUri, ...parentParts);
                    await vscode.workspace.fs.createDirectory(parentUri);
                }

                if (content !== undefined) {
                    const encodedContent = new TextEncoder().encode(content);
                    await vscode.workspace.fs.writeFile(fileUri, encodedContent);
                }
            }
        } catch (error) {
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
    }
}
