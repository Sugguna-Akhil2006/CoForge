import * as vscode from 'vscode';
import { CollaborativeDocument } from '../src/collaboration/document/CollaborativeDocument';
import { CollaborationClient } from '../src/network/CollaborationClient';
import * as Y from 'yjs';

// Mock VSCode
jest.mock('vscode', () => ({
    workspace: {
        onDidChangeTextDocument: jest.fn(),
        applyEdit: jest.fn().mockResolvedValue(true)
    },
    Range: class Range {
        constructor(public start: any, public end: any) {}
    },
    Position: class Position {
        constructor(public line: number, public character: number) {}
    },
    WorkspaceEdit: class WorkspaceEdit {
        replace = jest.fn();
        insert = jest.fn();
        delete = jest.fn();
    },
    Disposable: class Disposable {
        dispose = jest.fn();
    }
}), { virtual: true });

describe('VS Code CRDT Adapter', () => {
    let mockClient: jest.Mocked<CollaborationClient>;
    let mockDocument: any;
    let onDidChangeTextDocumentCallback: any;

    beforeEach(() => {
        mockClient = {
            sendDocumentUpdate: jest.fn(),
            on: jest.fn(),
        } as any;

        mockDocument = {
            uri: { scheme: 'file' },
            getText: jest.fn().mockReturnValue(''),
            positionAt: jest.fn().mockImplementation((idx) => ({ line: 0, character: idx }))
        };

        (vscode.workspace.onDidChangeTextDocument as jest.Mock).mockImplementation((cb) => {
            onDidChangeTextDocumentCallback = cb;
            return { dispose: jest.fn() };
        });

        jest.clearAllMocks();
    });

    test('Test 1 - VS Code edit triggers Yjs update and WebSocket send', () => {
        const collabDoc = new CollaborativeDocument('test.txt', 'session-1', mockClient, mockDocument);
        
        const changes = [
            {
                rangeOffset: 0,
                rangeLength: 0,
                text: 'Hello'
            }
        ];

        onDidChangeTextDocumentCallback({
            document: mockDocument,
            contentChanges: changes
        });

        expect(collabDoc.doc.getText('content').toString()).toBe('Hello');
        expect(mockClient.sendDocumentUpdate).toHaveBeenCalledWith('session-1', 'test.txt', expect.any(Uint8Array));
    });

    test('Test 2 - Remote Yjs update triggers VS Code edit', async () => {
        const collabDoc = new CollaborativeDocument('test.txt', 'session-1', mockClient, mockDocument);
        
        // Remote update from another Y.Doc
        const remoteDoc = new Y.Doc();
        remoteDoc.getText('content').insert(0, 'Remote');
        const update = Y.encodeStateAsUpdate(remoteDoc);

        collabDoc.applyRemoteUpdate(update);
        
        // Let promises resolve
        await new Promise(r => setTimeout(r, 0));

        expect(vscode.workspace.applyEdit).toHaveBeenCalled();
        const edit = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0][0];
        expect(edit.insert).toHaveBeenCalledWith(mockDocument.uri, {line: 0, character: 0}, 'Remote');
        
        // Should NOT echo back
        expect(mockClient.sendDocumentUpdate).not.toHaveBeenCalled();
    });

    test('Test 7 - Loop Prevention: remote update does not trigger local echo', async () => {
        const collabDoc = new CollaborativeDocument('test.txt', 'session-1', mockClient, mockDocument);
        
        // Send a remote update
        const remoteDoc = new Y.Doc();
        remoteDoc.getText('content').insert(0, 'LoopPrevent');
        const update = Y.encodeStateAsUpdate(remoteDoc);

        // Apply it
        collabDoc.applyRemoteUpdate(update);

        // This triggers applyingRemoteChange = true and schedules vscode.workspace.applyEdit
        // Let's pretend VS Code fires the change event right now:
        onDidChangeTextDocumentCallback({
            document: mockDocument,
            contentChanges: [{ rangeOffset: 0, rangeLength: 0, text: 'LoopPrevent' }]
        });

        // SendDocumentUpdate should NOT be called because applyingRemoteChange should be true
        expect(mockClient.sendDocumentUpdate).not.toHaveBeenCalled();
    });
});
