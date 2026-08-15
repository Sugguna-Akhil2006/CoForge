import { WebSocketClient } from '../src/network/WebSocketClient';
import { ConnectionState } from '../src/network/ConnectionState';

// Mock ws module
jest.mock('ws', () => {
    return {
        WebSocket: jest.fn().mockImplementation((url) => {
            const EventEmitter = require('events');
            class MockWS extends EventEmitter {
                public close = jest.fn();
                public send = jest.fn();
                public readyState = 1; // OPEN
            }
            const instance = new MockWS();
            // Store instance globally to control it in tests
            (global as any).__mockWsInstance = instance;
            
            // if url contains 'fail-instantiation', throw synchronously
            if (url.includes('fail-instantiation')) {
                throw new Error('Sync instantiation failed');
            }
            return instance;
        })
    };
});

describe('WebSocketClient', () => {
    let client: WebSocketClient;
    let mockLogger: any;

    beforeEach(() => {
        mockLogger = { log: jest.fn() };
        client = new WebSocketClient(mockLogger);
        (global as any).__mockWsInstance = undefined;
    });

    afterEach(() => {
        client.dispose();
    });

    it('should connect successfully (successful WebSocket connection)', async () => {
        const connectPromise = client.connect('wss://coforge.onrender.com');
        
        // Wait for next tick so instantiation happens
        await new Promise(r => setImmediate(r));
        const ws = (global as any).__mockWsInstance;
        expect(ws).toBeDefined();

        ws.emit('open');
        
        await expect(connectPromise).resolves.toBeUndefined();
        expect(client.getState()).toBe(ConnectionState.CONNECTED);
    });

    it('should handle WebSocket error with a message', async () => {
        const connectPromise = client.connect('wss://coforge.onrender.com');
        await new Promise(r => setImmediate(r));
        const ws = (global as any).__mockWsInstance;

        const error = new Error('Explicit error message');
        ws.emit('error', error);
        
        await expect(connectPromise).rejects.toThrow('WebSocket connection failed: Explicit error message');
        expect(client.getState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('should handle WebSocket error with an empty message', async () => {
        const connectPromise = client.connect('wss://coforge.onrender.com');
        await new Promise(r => setImmediate(r));
        const ws = (global as any).__mockWsInstance;

        const error = new Error(''); // Empty message
        (error as any).code = 'ECONNREFUSED';
        ws.emit('error', error);
        
        // Because of our logic, if message is empty, it falls back to code/name/stringify
        await expect(connectPromise).rejects.toThrow('WebSocket connection failed: ECONNREFUSED');
    });

    it('should handle WebSocket timeout', async () => {
        jest.useFakeTimers();
        const connectPromise = client.connect('wss://coforge.onrender.com');
        
        // Advance timers by 10s to trigger timeout
        jest.advanceTimersByTime(10000);
        
        await expect(connectPromise).rejects.toThrow('WebSocket connection timeout: wss://coforge.onrender.com');
        jest.useRealTimers();
    });
});
