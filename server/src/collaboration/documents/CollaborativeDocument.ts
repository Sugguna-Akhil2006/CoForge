import * as Y from 'yjs';

export class CollaborativeDocument {
    private doc: Y.Doc;
    private text: Y.Text;
    
    constructor(public readonly path: string, initialContent: string = '') {
        this.doc = new Y.Doc();
        this.text = this.doc.getText('content');
        
        // Initialize with existing content if any
        if (initialContent) {
            this.doc.transact(() => {
                this.text.insert(0, initialContent);
            }, 'server-init');
        }
    }

    public applyUpdate(update: Uint8Array): void {
        Y.applyUpdate(this.doc, update);
    }

    public encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array {
        return Y.encodeStateAsUpdate(this.doc, stateVector);
    }

    public encodeStateVector(): Uint8Array {
        return Y.encodeStateVector(this.doc);
    }
    
    public getContent(): string {
        return this.text.toString();
    }
}
