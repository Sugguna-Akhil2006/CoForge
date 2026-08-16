import { CollaborationServer } from '../server/src/server';
import { WebSocket } from 'ws';
import * as crypto from 'crypto';
import * as Y from 'yjs';

const PORT = 3011;
const SERVER_URL = `ws://localhost:${PORT}`;

describe('CRDT Synchronization', () => {
    let server: CollaborationServer;

    beforeAll((done) => {
        server = new CollaborationServer();
        server.start(PORT);
        setTimeout(done, 500);
    });

    afterAll(() => {
        server.stop();
    });

    function createMockClient(): Promise<{ws: WebSocket, clientId: string, sessionId: string, doc: Y.Doc}> {
        return new Promise((resolve) => {
            const ws = new WebSocket(SERVER_URL);
            let sessionId = '';
            let clientId = '';
            const doc = new Y.Doc();

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    messageId: crypto.randomUUID(),
                    protocolVersion: 1,
                    timestamp: Date.now(),
                    type: 'CREATE_SESSION',
                    payload: { workspaceId: 'test-ws' }
                }));
            });

            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'SESSION_CREATED') {
                    sessionId = msg.payload.sessionId;
                    clientId = msg.payload.clientId;
                    resolve({ws, clientId, sessionId, doc});
                }
            });
        });
    }

    function joinMockClient(sessionId: string): Promise<{ws: WebSocket, doc: Y.Doc}> {
        return new Promise((resolve) => {
            const ws = new WebSocket(SERVER_URL);
            const doc = new Y.Doc();

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    messageId: crypto.randomUUID(),
                    protocolVersion: 1,
                    timestamp: Date.now(),
                    type: 'JOIN_SESSION',
                    payload: { sessionId }
                }));
            });

            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'SESSION_JOINED') {
                    resolve({ws, doc});
                }
            });
        });
    }

    test('Concurrent typing (Two users)', async () => {
        const clientA = await createMockClient();
        const clientB = await joinMockClient(clientA.sessionId);

        const path = 'src/test.ts';

        // Join document
        const joinMsg = JSON.stringify({
            messageId: crypto.randomUUID(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: 'JOIN_DOCUMENT',
            payload: { sessionId: clientA.sessionId, path }
        });
        clientA.ws.send(joinMsg);
        clientB.ws.send(joinMsg);

        await new Promise(r => setTimeout(r, 100));

        // Setup message handlers for sync
        const handlerA = (data: any) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'DOCUMENT_UPDATE' && msg.payload.path === path) {
                Y.applyUpdate(clientA.doc, Buffer.from(msg.payload.update, 'base64'));
            }
        };
        const handlerB = (data: any) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'DOCUMENT_UPDATE' && msg.payload.path === path) {
                Y.applyUpdate(clientB.doc, Buffer.from(msg.payload.update, 'base64'));
            }
        };
        clientA.ws.on('message', handlerA);
        clientB.ws.on('message', handlerB);

        // A and B both type
        const textA = clientA.doc.getText('content');
        const textB = clientB.doc.getText('content');

        clientA.doc.on('update', (update) => {
            clientA.ws.send(JSON.stringify({
                messageId: crypto.randomUUID(),
                protocolVersion: 1,
                timestamp: Date.now(),
                type: 'DOCUMENT_UPDATE',
                payload: { sessionId: clientA.sessionId, path, update: Buffer.from(update).toString('base64') }
            }));
        });

        clientB.doc.on('update', (update) => {
            clientB.ws.send(JSON.stringify({
                messageId: crypto.randomUUID(),
                protocolVersion: 1,
                timestamp: Date.now(),
                type: 'DOCUMENT_UPDATE',
                payload: { sessionId: clientA.sessionId, path, update: Buffer.from(update).toString('base64') }
            }));
        });

        textA.insert(0, "Hello");
        textB.insert(0, " World");

        await new Promise(r => setTimeout(r, 500));

        expect(textA.toString()).toEqual(textB.toString());
        expect(textA.toString().length).toBe(11);
        
        clientA.ws.close();
        clientB.ws.close();
    });

    test('Three-client convergence', async () => {
        const clientA = await createMockClient();
        const clientB = await joinMockClient(clientA.sessionId);
        const clientC = await joinMockClient(clientA.sessionId);

        const path = 'src/three.ts';

        [clientA, clientB, clientC].forEach(c => {
            c.ws.send(JSON.stringify({
                messageId: crypto.randomUUID(),
                protocolVersion: 1,
                timestamp: Date.now(),
                type: 'JOIN_DOCUMENT',
                payload: { sessionId: clientA.sessionId, path }
            }));
            c.ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'DOCUMENT_UPDATE' && msg.payload.path === path) {
                    Y.applyUpdate(c.doc, Buffer.from(msg.payload.update, 'base64'));
                }
            });
            c.doc.on('update', (update) => {
                c.ws.send(JSON.stringify({
                    messageId: crypto.randomUUID(),
                    protocolVersion: 1,
                    timestamp: Date.now(),
                    type: 'DOCUMENT_UPDATE',
                    payload: { sessionId: clientA.sessionId, path, update: Buffer.from(update).toString('base64') }
                }));
            });
        });

        await new Promise(r => setTimeout(r, 100));

        const textA = clientA.doc.getText('content');
        const textB = clientB.doc.getText('content');
        const textC = clientC.doc.getText('content');

        textA.insert(0, "A");
        textB.insert(0, "B");
        textC.insert(0, "C");

        await new Promise(r => setTimeout(r, 500));

        expect(textA.toString()).toEqual(textB.toString());
        expect(textB.toString()).toEqual(textC.toString());
        expect(textA.toString().length).toBe(3);

        clientA.ws.close();
        clientB.ws.close();
        clientC.ws.close();
    });
});
