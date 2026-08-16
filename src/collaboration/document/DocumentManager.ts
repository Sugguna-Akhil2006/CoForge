import * as vscode from 'vscode';
import { CollaborativeDocument } from './CollaborativeDocument';
import { CollaborationClient } from '../../network/CollaborationClient';
import { DocumentUpdateMessage, DocumentSyncResponseMessage } from '../../protocol/Message';

export class DocumentManager {
    private documents = new Map<string, CollaborativeDocument>();
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly sessionId: string,
        private readonly collaborationClient: CollaborationClient
    ) {
        // Listen for remote updates
        this.collaborationClient.on('documentUpdate', (msg: DocumentUpdateMessage) => {
            const doc = this.documents.get(msg.payload.path);
            if (doc) {
                const updateBuffer = Buffer.from(msg.payload.update, 'base64');
                doc.applyRemoteUpdate(new Uint8Array(updateBuffer));
            }
        });

        // Listen for sync responses
        this.collaborationClient.on('documentSyncResponse', (msg: DocumentSyncResponseMessage) => {
            const doc = this.documents.get(msg.payload.path);
            if (doc) {
                const updateBuffer = Buffer.from(msg.payload.update, 'base64');
                doc.applyInitialState(new Uint8Array(updateBuffer));
            }
        });

        // Track active text editors
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === 'file') {
                this.joinDocument(editor.document);
            }
        }));
        
        // Track closed text documents
        this.disposables.push(vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc.uri.scheme === 'file') {
                this.leaveDocument(doc);
            }
        }));
        
        // Initial check for open editors
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
            this.joinDocument(vscode.window.activeTextEditor.document);
        }
    }

    private joinDocument(document: vscode.TextDocument): void {
        const path = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, '/');
        
        if (path.includes('.git/') || path.includes('node_modules/') || path.includes('.vscode/')) {
            return;
        }

        let doc = this.documents.get(path);
        if (!doc) {
            doc = new CollaborativeDocument(path, this.sessionId, this.collaborationClient, document);
            this.documents.set(path, doc);
            
            // Send JOIN_DOCUMENT
            this.collaborationClient.sendJoinDocument(this.sessionId, path);
            
            // Request sync
            const stateVector = doc.getStateVector();
            this.collaborationClient.sendDocumentSyncRequest(this.sessionId, path, stateVector);
        } else {
            doc.updateDocumentReference(document);
        }
    }

    private leaveDocument(document: vscode.TextDocument): void {
        const path = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, '/');
        const doc = this.documents.get(path);
        if (doc) {
            doc.dispose();
            this.documents.delete(path);
            this.collaborationClient.sendDocumentLeave(this.sessionId, path);
        }
    }

    public dispose(): void {
        this.documents.forEach(doc => doc.dispose());
        this.documents.clear();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
