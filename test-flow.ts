import { WebSocket } from 'ws';
import * as crypto from 'crypto';

const SERVER_URL = 'ws://localhost:3000';

const hostWs = new WebSocket(SERVER_URL);

hostWs.on('open', () => {
    console.log('Host connected');
    const sessionId = 'test-session';
    const messageId = crypto.randomUUID();
    
    const createMsg = {
        messageId,
        protocolVersion: 1,
        timestamp: Date.now(),
        type: 'CREATE_SESSION',
        payload: {
            workspaceId: 'host-workspace'
        }
    };
    hostWs.send(JSON.stringify(createMsg));
});

hostWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Host received:', msg.type);
    
    if (msg.type === 'SESSION_CREATED') {
        const sessionId = msg.payload.sessionId;
        console.log('Session created:', sessionId);
        
        // Start Guest
        startGuest(sessionId);
    } else if (msg.type === 'REQUEST_WORKSPACE_SNAPSHOT') {
        console.log('Host sending snapshot...');
        const snapshotMsg = {
            messageId: crypto.randomUUID(),
            correlationId: msg.messageId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: 'WORKSPACE_SNAPSHOT',
            payload: {
                sessionId: msg.payload.sessionId,
                files: [
                    { path: 'test.txt', content: 'hello world' }
                ]
            }
        };
        hostWs.send(JSON.stringify(snapshotMsg));
    }
});

function startGuest(sessionId: string) {
    const guestWs = new WebSocket(SERVER_URL);
    guestWs.on('open', () => {
        console.log('Guest connected');
        const joinMsg = {
            messageId: crypto.randomUUID(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: 'JOIN_SESSION',
            payload: {
                sessionId
            }
        };
        guestWs.send(JSON.stringify(joinMsg));
    });
    
    guestWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        console.log('Guest received:', msg.type);
        
        if (msg.type === 'SESSION_JOINED') {
            console.log('Guest joined. Requesting snapshot...');
            const reqMsg = {
                messageId: crypto.randomUUID(),
                protocolVersion: 1,
                timestamp: Date.now(),
                type: 'REQUEST_WORKSPACE_SNAPSHOT',
                payload: {
                    sessionId
                }
            };
            guestWs.send(JSON.stringify(reqMsg));
        } else if (msg.type === 'WORKSPACE_SNAPSHOT') {
            console.log('Guest received snapshot with files:', msg.payload.files.length);
            process.exit(0);
        }
    });
}
