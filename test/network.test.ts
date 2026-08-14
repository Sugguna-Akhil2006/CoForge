import { WebSocketClient } from '../src/network/WebSocketClient';
import { ConnectionState } from '../src/network/ConnectionState';
import { NetworkError } from '../src/network/NetworkError';
import { WebSocketServer } from 'ws';
import * as http from 'http';

describe('WebSocketClient', () => {
    let wss: WebSocketServer;
    let server: http.Server;
    let url: string;

    beforeAll((done) => {
        server = http.createServer();
        wss = new WebSocketServer({ server });
        server.listen(0, () => {
            const port = (server.address() as any).port;
            url = `ws://localhost:${port}`;
            done();
        });
    });

    afterAll((done) => {
        wss.close(() => {
            server.close(done);
        });
    });

    it('should have initial DISCONNECTED state', () => {
        const client = new WebSocketClient();
        expect(client.getState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('should connect successfully', async () => {
        const client = new WebSocketClient();
        await client.connect(url);
        expect(client.getState()).toBe(ConnectionState.CONNECTED);
        client.dispose();
    });

    it('should fail gracefully on invalid URL', async () => {
        const client = new WebSocketClient();
        await expect(client.connect('invalid-url')).rejects.toThrow(NetworkError);
    });

    it('should disconnect successfully', async () => {
        const client = new WebSocketClient();
        await client.connect(url);
        
        const disconnectPromise = new Promise<void>(resolve => {
            client.on('disconnected', () => resolve());
        });
        
        client.disconnect();
        await disconnectPromise;
        expect(client.getState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('should not send if disconnected', () => {
        const client = new WebSocketClient();
        expect(() => client.send({ test: true })).toThrow(NetworkError);
    });

    it('should handle malformed messages gracefully', (done) => {
        const client = new WebSocketClient();
        client.on('error', (err) => {
            expect(err.message).toMatch(/Malformed JSON/);
            client.dispose();
            done();
        });
        
        wss.once('connection', (ws) => {
            ws.send('not-a-json');
        });
        
        client.connect(url).catch(() => {});
    });
});
