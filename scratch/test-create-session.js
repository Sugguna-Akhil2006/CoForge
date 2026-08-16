const WebSocket = require('ws');
const crypto = require('crypto');

const url = 'wss://coforge.onrender.com';
console.log(`Connecting to ${url}...`);

const ws = new WebSocket(url);

ws.on('open', () => {
    console.log('WebSocket OPEN.');
    
    const messageId = crypto.randomUUID();
    const createMsg = {
        messageId,
        protocolVersion: 1,
        timestamp: Date.now(),
        type: 'CREATE_SESSION',
        payload: {
            workspaceId: 'test-workspace-id'
        }
    };
    
    console.log(`Sending CREATE_SESSION, messageId: ${messageId}`);
    ws.send(JSON.stringify(createMsg));
});

ws.on('message', (data) => {
    const text = data.toString('utf-8');
    console.log('Received message:', text);
    
    try {
        const msg = JSON.parse(text);
        if (msg.type === 'SESSION_CREATED') {
            console.log('SUCCESS! SESSION_CREATED received.');
            ws.close();
        }
    } catch (err) {
        console.error('Failed to parse response:', err);
    }
});

ws.on('error', (err) => {
    console.error('WebSocket error:', err);
});

ws.on('close', (code, reason) => {
    console.log(`WebSocket closed: code=${code}, reason=${reason}`);
});
