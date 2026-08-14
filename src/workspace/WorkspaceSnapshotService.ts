import * as vscode from 'vscode';
import * as path from 'path';
import { ILogger } from '../network/WebSocketClient';

export class WorkspaceSnapshotService {
    private readonly MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
    private readonly MAX_FILES = 1000;

    constructor(private readonly logger?: ILogger) {}

    private log(message: string): void {
        if (this.logger) {
            this.logger.log(message);
        } else {
            console.log(message);
        }
    }

    public async buildSnapshot(): Promise<Array<{ path: string; content: string }>> {
        this.log('[INFO] Building workspace snapshot...');
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.log('[INFO] No workspace folders open. Snapshot is empty.');
            this.log('[INFO] Workspace snapshot contains 0 files.');
            return [];
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        this.log(`[INFO] Workspace root: ${workspaceFolders[0].uri.toString()}`);
        const files: Array<{ path: string; content: string }> = [];

        // Exclude patterns
        const excludePattern = '**/{.git,node_modules,.vscode,dist,out,build,coverage,.env,.env.*}/**';

        const uris = await vscode.workspace.findFiles('**/*', excludePattern, this.MAX_FILES);
        
        for (const uri of uris) {
            const relativePath = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.size > this.MAX_FILE_SIZE) {
                    this.log(`[INFO] Skipping excluded file: ${relativePath} (too large)`);
                    continue;
                }

                const contentArray = await vscode.workspace.fs.readFile(uri);
                
                // Extremely basic binary check by checking for null bytes or typical binary extensions
                if (this.isLikelyBinary(uri.fsPath, contentArray)) {
                    this.log(`[INFO] Skipping excluded file: ${relativePath} (binary)`);
                    continue;
                }

                const content = new TextDecoder('utf-8').decode(contentArray);
                
                this.log(`[INFO] Discovered file: ${relativePath}`);
                files.push({
                    path: relativePath,
                    content
                });
            } catch (error) {
                this.log(`[WARN] Failed to read file ${uri.fsPath}: ${error}`);
            }
        }

        this.log(`[INFO] Snapshot complete. Files: ${files.length}`);
        this.log(`[INFO] Workspace snapshot contains ${files.length} files.`);
        return files;
    }

    private isLikelyBinary(filePath: string, content: Uint8Array): boolean {
        const ext = path.extname(filePath).toLowerCase();
        const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.exe', '.dll', '.zip', '.tar', '.gz'];
        if (binaryExtensions.includes(ext)) {
            return true;
        }

        // Check first 100 bytes for null character
        const limit = Math.min(100, content.length);
        for (let i = 0; i < limit; i++) {
            if (content[i] === 0) {
                return true;
            }
        }

        return false;
    }

    public async applySnapshot(
        files: Array<{ path: string; content: string }>
    ): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder is open in the guest window.');
        }

        const rootUri = workspaceFolders[0].uri;

        this.log(`[INFO] Applying workspace snapshot: ${files.length} files`);

        for (const file of files) {
            try {
                // Prevent paths from escaping the workspace
                const relativePath = file.path.replace(/\\/g, '/');

                if (
                    relativePath.startsWith('/') ||
                    relativePath.includes('../') ||
                    relativePath === '..'
                ) {
                    this.log(`[WARN] Skipping unsafe snapshot path: ${file.path}`);
                    continue;
                }

                const fileUri = vscode.Uri.joinPath(rootUri, ...relativePath.split('/'));

                // Create parent directories
                const parentParts = relativePath.split('/');
                parentParts.pop();

                if (parentParts.length > 0) {
                    const parentUri = vscode.Uri.joinPath(
                        rootUri,
                        ...parentParts
                    );

                    await vscode.workspace.fs.createDirectory(parentUri);
                }

                const content = new TextEncoder().encode(file.content);

                await vscode.workspace.fs.writeFile(fileUri, content);

                this.log(`[INFO] Wrote snapshot file: ${relativePath}`);
            } catch (error) {
                this.log(
                    `[ERROR] Failed to write snapshot file ${file.path}: ${error}`
                );
            }
        }

        this.log(`[INFO] Workspace snapshot applied successfully.`);
    }
}
