import * as vscode from 'vscode';
import * as Y from 'yjs';
import { CollaborationClient } from '../../network/CollaborationClient';

export class CollaborativeDocument {
    public doc: Y.Doc;
    private text: Y.Text;
    private disposables: vscode.Disposable[] = [];
    private applyingRemoteChange = false;
    private isSyncing = false;
    
    constructor(
        public readonly path: string,
        private readonly sessionId: string,
        private readonly collaborationClient: CollaborationClient,
        private document: vscode.TextDocument
    ) {
        this.doc = new Y.Doc();
        this.text = this.doc.getText('content');
        
        // Listen to remote changes coming into Y.Doc and apply to VSCode
        this.text.observe((event, transaction) => {
            if (transaction.origin !== this) {
                this.applyYjsChangesToVSCode(event);
            }
        });

        // Listen for local changes from VSCode and apply to Y.Doc
        this.disposables.push(vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document === this.document && !this.applyingRemoteChange && !this.isSyncing) {
                this.applyVSCodeChangesToYjs(e.contentChanges);
            }
        }));
    }

    public updateDocumentReference(document: vscode.TextDocument): void {
        this.document = document;
    }

    public async applyInitialState(update: Uint8Array): Promise<void> {
        this.isSyncing = true;
        try {
            Y.applyUpdate(this.doc, update);
            
            // Sync VS Code document with Yjs state
            const currentText = this.document.getText();
            const yjsText = this.text.toString();
            
            if (currentText !== yjsText) {
                this.applyingRemoteChange = true;
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(
                    this.document.positionAt(0),
                    this.document.positionAt(currentText.length)
                );
                edit.replace(this.document.uri, fullRange, yjsText);
                await vscode.workspace.applyEdit(edit);
                this.applyingRemoteChange = false;
            }
        } finally {
            this.isSyncing = false;
        }
    }

    public applyRemoteUpdate(update: Uint8Array): void {
        Y.applyUpdate(this.doc, update);
    }

    private applyVSCodeChangesToYjs(changes: readonly vscode.TextDocumentContentChangeEvent[]): void {
        this.doc.transact(() => {
            // VSCode events are sorted from end to start for concurrent non-overlapping edits,
            // but we might need to handle them carefully. Wait, actually we can just apply them as given 
            // since we do it immediately on the change event.
            for (const change of changes) {
                this.text.delete(change.rangeOffset, change.rangeLength);
                if (change.text.length > 0) {
                    this.text.insert(change.rangeOffset, change.text);
                }
            }
        }, this);

        // Send update to server
        const update = Y.encodeStateAsUpdate(this.doc);
        this.collaborationClient.sendDocumentUpdate(this.sessionId, this.path, update);
    }

    private async applyYjsChangesToVSCode(event: Y.YTextEvent): Promise<void> {
        this.applyingRemoteChange = true;
        
        try {
            const edit = new vscode.WorkspaceEdit();
            let index = 0;
            
            // event.delta contains retained, inserted, and deleted segments
            for (const delta of event.delta) {
                if (delta.retain !== undefined) {
                    index += delta.retain;
                } else if (delta.insert !== undefined) {
                    const insertText = delta.insert as string;
                    const pos = this.document.positionAt(index);
                    edit.insert(this.document.uri, pos, insertText);
                    index += insertText.length;
                } else if (delta.delete !== undefined) {
                    const startPos = this.document.positionAt(index);
                    const endPos = this.document.positionAt(index + delta.delete);
                    edit.delete(this.document.uri, new vscode.Range(startPos, endPos));
                }
            }

            await vscode.workspace.applyEdit(edit);
        } catch (error) {
            console.error(`[ERROR] Failed to apply Yjs changes to VS Code:`, error);
        } finally {
            // Using a short timeout to prevent rapid overlapping change events from triggering the listener
            setTimeout(() => {
                this.applyingRemoteChange = false;
            }, 10);
        }
    }

    public getStateVector(): Uint8Array {
        return Y.encodeStateVector(this.doc);
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.doc.destroy();
    }
}
