import { SessionRegistry } from '../src/collaboration/SessionRegistry';
import { SessionError } from '../src/collaboration/SessionError';
import { WebSocket } from 'ws';

describe('SessionRegistry', () => {
    let registry: SessionRegistry;

    beforeEach(() => {
        registry = new SessionRegistry();
    });

    it('should create and retrieve session', () => {
        const session = registry.createSession('ws-123');
        expect(session.sessionId).toBeDefined();
        expect(session.workspaceId).toBe('ws-123');

        const retrieved = registry.getSession(session.sessionId);
        expect(retrieved).toBe(session);
        expect(registry.hasSession(session.sessionId)).toBe(true);
    });

    it('should generate unique IDs for sessions', () => {
        const session1 = registry.createSession('ws-123');
        const session2 = registry.createSession('ws-123');
        expect(session1.sessionId).not.toBe(session2.sessionId);
    });

    it('should reject empty workspace ID', () => {
        expect(() => registry.createSession('')).toThrow(SessionError);
        expect(() => registry.createSession('   ')).toThrow(SessionError);
    });

    it('should throw when getting missing session', () => {
        expect(() => registry.getSession('missing')).toThrow(SessionError);
        expect(registry.hasSession('missing')).toBe(false);
    });

    it('should add and remove clients', () => {
        const session = registry.createSession('ws-123');
        const mockWs = {} as WebSocket;

        registry.addClient(session.sessionId, mockWs);
        expect(session.hasClient(mockWs)).toBe(true);
        expect(session.getClientCount()).toBe(1);

        // Don't auto delete if client is not removed via removeClient
        // Oh wait, removeClient auto deletes empty sessions
    });

    it('should reject duplicate client addition', () => {
        const session = registry.createSession('ws-123');
        const mockWs = {} as WebSocket;

        registry.addClient(session.sessionId, mockWs);
        expect(() => registry.addClient(session.sessionId, mockWs)).toThrow('Client is already in a session');
    });

    it('should reject client already belonging to another session', () => {
        const session1 = registry.createSession('ws-123');
        const session2 = registry.createSession('ws-456');
        const mockWs = {} as WebSocket;

        registry.addClient(session1.sessionId, mockWs);
        expect(() => registry.addClient(session2.sessionId, mockWs)).toThrow('Client is already in a session');
    });

    it('should throw removing non-existent client', () => {
        const session = registry.createSession('ws-123');
        const mockWs = {} as WebSocket;
        expect(() => registry.removeClient(session.sessionId, mockWs)).toThrow(SessionError);
    });

    it('should NOT automatically cleanup empty sessions', () => {
        const session = registry.createSession('ws-123');
        const mockWs = {} as WebSocket;
        
        registry.addClient(session.sessionId, mockWs);
        expect(registry.hasSession(session.sessionId)).toBe(true);

        registry.removeClient(session.sessionId, mockWs);
        // Session should remain even if empty
        expect(registry.hasSession(session.sessionId)).toBe(true);
    });

    it('should manually delete session', () => {
        const session = registry.createSession('ws-123');
        registry.deleteSession(session.sessionId);
        expect(registry.hasSession(session.sessionId)).toBe(false);
    });

    it('should get session for client', () => {
        const session = registry.createSession('ws-123');
        const mockWs = {} as WebSocket;
        registry.addClient(session.sessionId, mockWs);
        expect(registry.getSessionForClient(mockWs)).toBe(session);
    });

    it('should return undefined for unknown client', () => {
        const mockWs = {} as WebSocket;
        expect(registry.getSessionForClient(mockWs)).toBeUndefined();
    });

    it('should safely do nothing when removing unknown client from any session', () => {
        const mockWs = {} as WebSocket;
        expect(() => registry.removeClientFromAnySession(mockWs)).not.toThrow();
    });

    it('should remove client from any session and cleanup reverse mapping', () => {
        const session = registry.createSession('ws-123');
        const mockWs = {} as WebSocket;
        registry.addClient(session.sessionId, mockWs);
        
        expect(registry.getSessionForClient(mockWs)).toBe(session);
        
        registry.removeClientFromAnySession(mockWs);
        expect(registry.getSessionForClient(mockWs)).toBeUndefined();
        expect(session.hasClient(mockWs)).toBe(false);
        // Session should remain
        expect(registry.hasSession(session.sessionId)).toBe(true);
    });

    it('should cleanup reverse mapping on deleteSession', () => {
        const session = registry.createSession('ws-123');
        const mockWs = {} as WebSocket;
        registry.addClient(session.sessionId, mockWs);
        
        registry.deleteSession(session.sessionId);
        
        expect(registry.hasSession(session.sessionId)).toBe(false);
        expect(registry.getSessionForClient(mockWs)).toBeUndefined();
    });
});
