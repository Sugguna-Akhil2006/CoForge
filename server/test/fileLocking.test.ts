import { WebSocket } from 'ws';
import { CollaborationServer } from '../src/server';
import { MessageType } from '../../src/protocol/MessageType';
import { Message } from '../../src/protocol/Message';

describe('File Locking System', () => {
    let server: CollaborationServer;
    let wsA: WebSocket;
    let wsB: WebSocket;
    let sessionId: string;
    let clientAId: string;
    let clientBId: string;
    let port: number;

    const connectClient = (url: string): Promise<WebSocket> => {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            
            const cleanup = () => {
                ws.removeListener('open', onOpen);
                ws.removeListener('error', onError);
                ws.removeListener('close', onClose);
            };

            const onOpen = () => {
                cleanup();
                resolve(ws);
            };

            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };

            const onClose = () => {
                cleanup();
                reject(new Error('WebSocket closed before opening'));
            };

            ws.once('open', onOpen);
            ws.once('error', onError);
            ws.once('close', onClose);
        });
    };

    const closeClient = (ws: WebSocket): Promise<void> => {
        return new Promise((resolve) => {
            if (!ws || ws.readyState === WebSocket.CLOSED) {
                return resolve();
            }
            ws.once('close', resolve);
            ws.once('error', resolve); // ignore errors during close
            ws.close();
        });
    };

    beforeEach(async () => {
        server = new CollaborationServer();
        await server.start(0);
        port = server.getPort();

        wsA = await connectClient(`ws://localhost:${port}`);
        wsB = await connectClient(`ws://localhost:${port}`);
    });

    afterEach(async () => {
        await closeClient(wsA);
        await closeClient(wsB);
        await server.stop();
    });

    const sendMsg = (ws: WebSocket, type: MessageType, payload: any) => {
        ws.send(JSON.stringify({
            messageId: Math.random().toString(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type,
            payload
        }));
    };

    const waitForMessage = (ws: WebSocket, type: MessageType): Promise<any> => {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                ws.removeListener('message', listener);
                reject(new Error(`Timeout waiting for message type ${type}`));
            }, 5000);

            const listener = (data: any) => {
                const msg = JSON.parse(data.toString()) as Message;
                if (msg.type === type) {
                    clearTimeout(timeout);
                    ws.removeListener('message', listener);
                    resolve(msg.payload);
                }
            };
            ws.on('message', listener);
        });
    };

    test('should allow independent file locking for different documents', async () => {
        // 1. Client A creates session
        sendMsg(wsA, MessageType.CREATE_SESSION, { workspaceId: 'ws-lock-test' });
        const createRes = await waitForMessage(wsA, MessageType.SESSION_CREATED);
        sessionId = createRes.sessionId;
        clientAId = createRes.clientId;

        // 2. Client B joins session
        sendMsg(wsB, MessageType.JOIN_SESSION, { sessionId });
        const joinRes = await waitForMessage(wsB, MessageType.SESSION_JOINED);
        clientBId = joinRes.clientId;

        // 3. Client A requests lock on main.ts
        sendMsg(wsA, MessageType.REQUEST_FILE_LOCK, { sessionId, path: 'src/main.ts' });
        
        // Both should receive FILE_LOCK_GRANTED
        const grantA = await waitForMessage(wsA, MessageType.FILE_LOCK_GRANTED);
        const grantB = await waitForMessage(wsB, MessageType.FILE_LOCK_GRANTED);
        
        expect(grantA.path).toBe('src/main.ts');
        expect(grantA.ownerClientId).toBe(clientAId);
        expect(grantB.path).toBe('src/main.ts');
        expect(grantB.ownerClientId).toBe(clientAId);

        // 4. Client B requests lock on utils.ts
        sendMsg(wsB, MessageType.REQUEST_FILE_LOCK, { sessionId, path: 'src/utils.ts' });
        
        const grantB2 = await waitForMessage(wsB, MessageType.FILE_LOCK_GRANTED);
        const grantA2 = await waitForMessage(wsA, MessageType.FILE_LOCK_GRANTED);
        
        expect(grantB2.path).toBe('src/utils.ts');
        expect(grantB2.ownerClientId).toBe(clientBId);
        expect(grantA2.path).toBe('src/utils.ts');
        expect(grantA2.ownerClientId).toBe(clientBId);
    });

    test('should reject SAVE_DOCUMENT only for the locked file', async () => {
        // Setup: A creates session, B joins, A locks main.ts
        sendMsg(wsA, MessageType.CREATE_SESSION, { workspaceId: 'ws-lock-test-2' });
        const createRes = await waitForMessage(wsA, MessageType.SESSION_CREATED);
        sessionId = createRes.sessionId;
        clientAId = createRes.clientId;

        sendMsg(wsB, MessageType.JOIN_SESSION, { sessionId });
        const joinRes = await waitForMessage(wsB, MessageType.SESSION_JOINED);
        clientBId = joinRes.clientId;

        sendMsg(wsA, MessageType.REQUEST_FILE_LOCK, { sessionId, path: 'src/main.ts' });
        await waitForMessage(wsA, MessageType.FILE_LOCK_GRANTED);
        await waitForMessage(wsB, MessageType.FILE_LOCK_GRANTED);

        // Client B tries to save main.ts (Locked by A)
        sendMsg(wsB, MessageType.SAVE_DOCUMENT, { sessionId, path: 'src/main.ts', baseRevision: 0, content: 'test' });
        
        const docLocked = await waitForMessage(wsB, MessageType.DOCUMENT_LOCKED);
        expect(docLocked.documentId).toBe('src/main.ts');
        expect(docLocked.ownerClientId).toBe(clientAId);

        // Client B tries to save utils.ts (Not locked, effectively Locked by B when saving if following full flow, but we just check save is allowed)
        sendMsg(wsB, MessageType.SAVE_DOCUMENT, { sessionId, path: 'src/utils.ts', baseRevision: 0, content: 'test' });
        
        // Client A should receive FILE_CHANGED for utils.ts
        const fileChanged = await waitForMessage(wsA, MessageType.FILE_CHANGED);
        expect(fileChanged.path).toBe('src/utils.ts');
    });
});
