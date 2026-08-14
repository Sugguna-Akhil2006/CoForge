import { CollaborationClient } from '../src/network/CollaborationClient';
import { WebSocketClient } from '../src/network/WebSocketClient';
import { MessageType } from '../src/protocol/MessageType';
import { NetworkError } from '../src/network/NetworkError';
import { EventEmitter } from 'events';

// Create a mock WebSocketClient that we can control
class MockWebSocketClient extends EventEmitter {
    public connect = jest.fn();
    public disconnect = jest.fn();
    public send = jest.fn();
    public dispose = jest.fn();
    public getState = jest.fn();
    public isConnected = jest.fn().mockReturnValue(true);
}

describe('CollaborationClient', () => {
    let mockWs: MockWebSocketClient;
    let client: CollaborationClient;
    let logger: any;

    beforeEach(() => {
        mockWs = new MockWebSocketClient();
        logger = { log: jest.fn() };
        client = new CollaborationClient(logger, mockWs as unknown as WebSocketClient);
    });

    afterEach(() => {
        client.dispose();
    });

    it('should connect to ws://localhost:3000 by default', async () => {
        mockWs.connect.mockResolvedValue(undefined);
        await client.connect();
        expect(mockWs.connect).toHaveBeenCalledWith('ws://localhost:3000');
    });

    it('should disconnect using underlying client', () => {
        client.disconnect();
        expect(mockWs.disconnect).toHaveBeenCalled();
    });

    it('should handle connection failure', async () => {
        const error = new NetworkError('Failed to connect');
        mockWs.connect.mockRejectedValue(error);
        await expect(client.connect()).rejects.toThrow(error);
    });

    it('should send PING and handle PONG', async () => {
        let sentMessage: any = null;
        mockWs.send.mockImplementation((msg) => {
            sentMessage = msg;
        });

        const pingPromise = client.ping(1000);
        
        // Wait for next tick so send is called
        await new Promise(r => setImmediate(r));
        
        expect(mockWs.send).toHaveBeenCalled();
        expect(sentMessage.type).toBe(MessageType.PING);

        // Simulate server response
        const pongMessage = {
            messageId: 'pong-id-123',
            correlationId: sentMessage.messageId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.PONG,
            payload: null
        };
        
        mockWs.emit('message', pongMessage);
        
        const result = await pingPromise;
        expect(result).toEqual(pongMessage);
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Server responded successfully with PONG'));
    });

    it('should handle invalid messages from server', () => {
        mockWs.emit('message', { type: 'INVALID_TYPE' });
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Received invalid protocol message'));
    });

    it('should handle malformed messages from server', () => {
        mockWs.emit('message', 'not a json object');
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Received invalid protocol message'));
    });

    it('should reject PING on timeout', async () => {
        jest.useFakeTimers();
        const pingPromise = client.ping(1000);
        
        // Wait for next tick so send is called
        await Promise.resolve();
        
        jest.advanceTimersByTime(1000);
        
        await expect(pingPromise).rejects.toThrow('PING request timed out');
        jest.useRealTimers();
    });

    it('should reject pending PINGs on disconnect', async () => {
        const pingPromise = client.ping(1000);
        await Promise.resolve();
        
        mockWs.emit('disconnected');
        
        await expect(pingPromise).rejects.toThrow('CollaborationClient disconnected from server');
    });

    it('should reject pending PINGs on dispose', async () => {
        const pingPromise = client.ping(1000);
        await Promise.resolve();
        
        client.dispose();
        
        await expect(pingPromise).rejects.toThrow('CollaborationClient disposed');
    });

    it('should handle multiple simultaneous PING requests', async () => {
        let sentMessages: any[] = [];
        mockWs.send.mockImplementation((msg) => {
            sentMessages.push(msg);
        });

        const pingPromise1 = client.ping(1000);
        const pingPromise2 = client.ping(1000);
        
        await Promise.resolve();
        
        expect(sentMessages.length).toBe(2);

        // Resolve second ping first
        mockWs.emit('message', {
            messageId: 'pong-2',
            correlationId: sentMessages[1].messageId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.PONG,
            payload: null
        });

        const result2 = await pingPromise2;
        expect(result2.messageId).toBe('pong-2');

        // Resolve first ping
        mockWs.emit('message', {
            messageId: 'pong-1',
            correlationId: sentMessages[0].messageId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.PONG,
            payload: null
        });

        const result1 = await pingPromise1;
        expect(result1.messageId).toBe('pong-1');
    });

    it('should send JOIN_SESSION and handle SESSION_JOINED', async () => {
        let sentMessage: any = null;
        mockWs.send.mockImplementation((msg) => {
            sentMessage = msg;
        });

        const joinPromise = client.joinSession('session-123', 1000);
        
        await new Promise(r => setImmediate(r));
        
        expect(mockWs.send).toHaveBeenCalled();
        expect(sentMessage.type).toBe(MessageType.JOIN_SESSION);
        expect(sentMessage.payload.sessionId).toBe('session-123');

        // Simulate server response
        const joinedMessage = {
            messageId: 'joined-123',
            correlationId: sentMessage.messageId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.SESSION_JOINED,
            payload: {
                sessionId: 'session-123'
            }
        };
        
        mockWs.emit('message', joinedMessage);
        
        await expect(joinPromise).resolves.toBeDefined();
    });

    it('should reject joinSession on ERROR response', async () => {
        let sentMessage: any = null;
        mockWs.send.mockImplementation((msg) => {
            sentMessage = msg;
        });

        const joinPromise = client.joinSession('session-123', 1000);
        await new Promise(r => setImmediate(r));

        const errorMessage = {
            messageId: 'error-123',
            correlationId: sentMessage.messageId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.ERROR,
            payload: {
                code: 'SESSION_NOT_FOUND',
                message: 'Session not found'
            }
        };
        
        mockWs.emit('message', errorMessage);
        
        await expect(joinPromise).rejects.toThrow('Server error: SESSION_NOT_FOUND - Session not found');
    });

    it('should reject joinSession on timeout', async () => {
        jest.useFakeTimers();
        const joinPromise = client.joinSession('session-123', 1000);
        
        await Promise.resolve();
        jest.advanceTimersByTime(1000);
        
        await expect(joinPromise).rejects.toThrow('JOIN_SESSION request timed out');
        jest.useRealTimers();
    });

    it('should reject empty session ID', async () => {
        await expect(client.joinSession('')).rejects.toThrow('Session ID cannot be empty');
        await expect(client.joinSession('   ')).rejects.toThrow('Session ID cannot be empty');
    });

    it('should not resolve joinSession on unrelated SESSION_JOINED', async () => {
        jest.useFakeTimers();
        
        const joinPromise = client.joinSession('session-123', 1000);
        await Promise.resolve();

        const unrelatedJoinedMessage = {
            messageId: 'joined-other',
            correlationId: 'some-other-correlation-id',
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.SESSION_JOINED,
            payload: {
                sessionId: 'session-123'
            }
        };
        
        mockWs.emit('message', unrelatedJoinedMessage);
        
        // It shouldn't resolve. Let's advance timers so it times out instead.
        jest.advanceTimersByTime(1000);
        
        await expect(joinPromise).rejects.toThrow('JOIN_SESSION request timed out');
        jest.useRealTimers();
    });
});
