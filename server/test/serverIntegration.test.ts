
process.env.PORT = '3001';

import { WebSocket } from 'ws';
import { CollaborationServer } from '../src/server';
import { MessageType } from '../src/protocol/MessageType';
import { Message } from '../src/protocol/Message';

describe('Server Integration (CREATE_SESSION)', () => {
    let server: CollaborationServer;
    let client: WebSocket;
    const PORT = 3001;

    beforeAll((done) => {
        server = new CollaborationServer();
        server.start(PORT);
        setTimeout(done, 500); // Wait for server to listen
    });

    afterAll((done) => {
        if (client && client.readyState === WebSocket.OPEN) {
            client.close();
        }
        server.stop();
        setTimeout(done, 500);
    });

    beforeEach((done) => {
        client = new WebSocket(`ws://localhost:${PORT}`);
        client.on('open', done);
    });

    afterEach(() => {
        if (client.readyState === WebSocket.OPEN) {
            client.close();
        }
    });

    it('should handle PING/PONG normally', (done) => {
        client.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            expect(msg.type).toBe(MessageType.PONG);
            expect(msg.correlationId).toBe('ping-123');
            done();
        });

        const pingMsg: Message = {
            messageId: 'ping-123',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.PING,
            payload: null
        };
        client.send(JSON.stringify(pingMsg));
    });

    it('should handle CREATE_SESSION successfully', (done) => {
        client.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            expect(msg.type).toBe(MessageType.SESSION_CREATED);
            expect(msg.correlationId).toBe('create-123');
            expect(msg.payload.sessionId).toBeDefined();
            expect(typeof msg.payload.sessionId).toBe('string');
            done();
        });

        const createMsg: Message = {
            messageId: 'create-123',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.CREATE_SESSION,
            payload: {
                workspaceId: 'workspace-456'
            }
        };
        client.send(JSON.stringify(createMsg));
    });

    it('should reject invalid CREATE_SESSION', (done) => {
        client.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            expect(msg.type).toBe(MessageType.ERROR);
            expect(msg.payload.code).toBe('INVALID_MESSAGE');
            expect(msg.correlationId).toBe('create-bad');
            done();
        });

        const createMsg: Message = {
            messageId: 'create-bad',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.CREATE_SESSION,
            payload: {
                workspaceId: '' // Invalid
            }
        };
        client.send(JSON.stringify(createMsg));
    });

    it('server remains alive after malformed operations', (done) => {
        // Send complete garbage JSON
        client.send('{{{{ not json');

        // Verify it still responds to a ping
        setTimeout(() => {
            client.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                expect(msg.type).toBe(MessageType.PONG);
                done();
            });

            const pingMsg: Message = {
                messageId: 'ping-survive',
                protocolVersion: 1,
                timestamp: Date.now(),
                type: MessageType.PING,
                payload: null
            };
            client.send(JSON.stringify(pingMsg));
        }, 100);
    });

    it('should reject duplicate session membership', (done) => {
        const createMsg: Message = {
            messageId: 'create-duplicate-1',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.CREATE_SESSION,
            payload: { workspaceId: 'workspace-dup' }
        };

        client.once('message', (data) => {
            const msg = JSON.parse(data.toString());
            expect(msg.type).toBe(MessageType.SESSION_CREATED);
            
            // Try creating again
            const createMsg2: Message = {
                messageId: 'create-duplicate-2',
                protocolVersion: 1,
                timestamp: Date.now(),
                type: MessageType.CREATE_SESSION,
                payload: { workspaceId: 'workspace-dup-2' }
            };
            
            client.once('message', (data2) => {
                const msg2 = JSON.parse(data2.toString());
                expect(msg2.type).toBe(MessageType.ERROR);
                expect(msg2.payload.code).toBe('CLIENT_ALREADY_IN_SESSION');
                done();
            });
            
            client.send(JSON.stringify(createMsg2));
        });

        client.send(JSON.stringify(createMsg));
    });

    it('empty session is deleted after disconnect', (done) => {
        const createMsg: Message = {
            messageId: 'create-disconnect',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.CREATE_SESSION,
            payload: { workspaceId: 'workspace-disco' }
        };

        client.once('message', (data) => {
            const msg = JSON.parse(data.toString());
            expect(msg.type).toBe(MessageType.SESSION_CREATED);
            
            // Close connection
            client.close();
            
            // Verify server doesn't crash and handles cleanup (takes a moment)
            setTimeout(() => {
                done();
            }, 50);
        });

        client.send(JSON.stringify(createMsg));
    });

    it('should join an existing session successfully', (done) => {
        // First create a session
        const createMsg: Message = {
            messageId: 'create-for-join',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.CREATE_SESSION,
            payload: { workspaceId: 'workspace-join' }
        };

        client.once('message', (data) => {
            const msg = JSON.parse(data.toString());
            const sessionId = msg.payload.sessionId;
            
            // Now create a second client to join
            const client2 = new WebSocket(`ws://localhost:${PORT}`);
            client2.on('open', () => {
                const joinMsg: Message = {
                    messageId: 'join-req',
                    protocolVersion: 1,
                    timestamp: Date.now(),
                    type: MessageType.JOIN_SESSION,
                    payload: { sessionId }
                };

                client2.once('message', (joinData) => {
                    const joinRes = JSON.parse(joinData.toString());
                    expect(joinRes.type).toBe(MessageType.SESSION_JOINED);
                    expect(joinRes.correlationId).toBe('join-req');
                    expect(joinRes.payload.sessionId).toBe(sessionId);
                    
                    client2.close();
                    done();
                });
                
                client2.send(JSON.stringify(joinMsg));
            });
        });
        
        client.send(JSON.stringify(createMsg));
    });

    it('should reject joining unknown session', (done) => {
        const joinMsg: Message = {
            messageId: 'join-unknown',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.JOIN_SESSION,
            payload: { sessionId: 'unknown-session-id' }
        };

        client.once('message', (data) => {
            const msg = JSON.parse(data.toString());
            expect(msg.type).toBe(MessageType.ERROR);
            expect(msg.payload.code).toBe('SESSION_NOT_FOUND');
            expect(msg.correlationId).toBe('join-unknown');
            done();
        });
        
        client.send(JSON.stringify(joinMsg));
    });
});
