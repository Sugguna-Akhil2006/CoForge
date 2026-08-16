import { WebSocket } from 'ws';
import { CollaborationServer } from '../src/server';
import { MessageType } from '../src/protocol/MessageType';
import { Message, SaveDocumentMessage, SaveRejectedMessage, FileChangedMessage } from '../src/protocol/Message';

const PORT = 3012;
const SERVER_URL = `ws://localhost:${PORT}`;

describe('Save-Based Synchronization Model', () => {
    let server: CollaborationServer;

    beforeAll(async () => {
        server = new CollaborationServer();
        await server.start(PORT);
    });

    afterAll(async () => {
        await server.stop();
    });

    const createClient = (): Promise<WebSocket> => {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(SERVER_URL);
            ws.once('open', () => resolve(ws));
            ws.once('error', reject);
        });
    };

    const waitForMessage = (ws: WebSocket, type: MessageType, timeoutMs = 2000): Promise<Message> => {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                ws.off('message', listener);
                reject(new Error(`Timeout waiting for message type: ${type}`));
            }, timeoutMs);

            const listener = (data: Buffer) => {
                const msg = JSON.parse(data.toString()) as Message;
                if (msg.type === type) {
                    clearTimeout(timeout);
                    ws.off('message', listener);
                    resolve(msg);
                }
            };
            ws.on('message', listener);
        });
    };

    const joinSession = async (ws: WebSocket, sessionId: string): Promise<string> => {
        ws.send(JSON.stringify({
            messageId: Math.random().toString(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.JOIN_SESSION,
            payload: { sessionId }
        }));
        const msg = await waitForMessage(ws, MessageType.SESSION_JOINED);
        return (msg.payload as any).clientId;
    };

    it('should atomically process simultaneous saves (First Save Wins)', async () => {
        const clientA = await createClient();
        const clientB = await createClient();

        // 1. Client A creates a session
        clientA.send(JSON.stringify({
            messageId: 'create-session',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.CREATE_SESSION,
            payload: { workspaceId: 'test-workspace' }
        }));
        
        const sessionCreatedMsg = await waitForMessage(clientA, MessageType.SESSION_CREATED);
        const sessionId = (sessionCreatedMsg.payload as any).sessionId;
        const clientIdA = (sessionCreatedMsg.payload as any).clientId;

        // 2. Client B joins the session
        const clientIdB = await joinSession(clientB, sessionId);

        const filePath = 'test.ts';

        // 3. Client A creates the file
        clientA.send(JSON.stringify({
            messageId: 'create-file',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.FILE_CREATED,
            payload: {
                sessionId,
                path: filePath,
                content: 'initial content',
                baseRevision: 0,
                revision: 10,
                clientId: clientIdA
            }
        }));

        await waitForMessage(clientB, MessageType.FILE_CREATED);

        // Current state: revision 1.
        // A has "hello A", B has "hello B". Both send a save for baseRevision=1.

        const saveMsgA: SaveDocumentMessage = {
            messageId: 'save-a',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.SAVE_DOCUMENT,
            payload: {
                sessionId,
                path: filePath,
                baseRevision: 1,
                content: 'hello A'
            }
        };

        const saveMsgB: SaveDocumentMessage = {
            messageId: 'save-b',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.SAVE_DOCUMENT,
            payload: {
                sessionId,
                path: filePath,
                baseRevision: 1,
                content: 'hello B'
            }
        };

        // We use promises to capture their respective responses with timeouts
        const createSavePromise = (ws: WebSocket, clientId: string) => {
            return new Promise<Message>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    ws.off('message', listener);
                    reject(new Error(`Timeout waiting for save response for ${clientId}`));
                }, 2000);

                const listener = (data: Buffer) => {
                    const msg = JSON.parse(data.toString()) as Message;
                    if ((msg.type === MessageType.FILE_CHANGED && (msg.payload as any).clientId === clientId) || msg.type === MessageType.SAVE_REJECTED) {
                        clearTimeout(timeout);
                        ws.off('message', listener);
                        resolve(msg);
                    }
                };
                ws.on('message', listener);
                ws.once('error', reject);
                ws.once('close', () => {
                    clearTimeout(timeout);
                    ws.off('message', listener);
                });
            });
        };

        const promiseA = createSavePromise(clientA, clientIdA);
        const promiseB = createSavePromise(clientB, clientIdB);

        // Send concurrently
        clientA.send(JSON.stringify(saveMsgA));
        clientB.send(JSON.stringify(saveMsgB));

        const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

        // Exactly one should be FILE_CHANGED and one should be SAVE_REJECTED
        const types = [resultA.type, resultB.type].sort();
        expect(types).toEqual([MessageType.FILE_CHANGED, MessageType.SAVE_REJECTED]);

        // The accepted one should have revision 2
        const acceptedMsg = (resultA.type === MessageType.FILE_CHANGED ? resultA : resultB) as FileChangedMessage;
        expect(acceptedMsg.payload.revision).toBe(2);

        // The rejected one should have currentRevision 2 and currentContent equal to the winner's content
        const rejectedMsg = (resultA.type === MessageType.SAVE_REJECTED ? resultA : resultB) as SaveRejectedMessage;
        expect(rejectedMsg.payload.currentRevision).toBe(2);
        expect(rejectedMsg.payload.currentContent).toBe(acceptedMsg.payload.content);

        // Cleanup
        const closePromiseA = new Promise(resolve => clientA.once('close', resolve));
        const closePromiseB = new Promise(resolve => clientB.once('close', resolve));
        clientA.close();
        clientB.close();
        await Promise.all([closePromiseA, closePromiseB]);
    });
});
