import { MessageType } from '../src/protocol/MessageType';
import { MessageValidator } from '../src/protocol/MessageValidator';

describe('MessageValidator', () => {
    const validBase = {
        messageId: '123',
        protocolVersion: 1,
        timestamp: Date.now()
    };

    it('should validate PING message', () => {
        const msg = {
            ...validBase,
            type: MessageType.PING,
            payload: null
        };
        expect(MessageValidator.isValidMessage(msg)).toBe(true);
    });

    it('should validate PONG message', () => {
        const msg = {
            ...validBase,
            type: MessageType.PONG,
            payload: null
        };
        expect(MessageValidator.isValidMessage(msg)).toBe(true);
    });

    it('should validate CREATE_SESSION message', () => {
        const msg = {
            ...validBase,
            type: MessageType.CREATE_SESSION,
            payload: { workspaceId: 'ws-123' }
        };
        expect(MessageValidator.isValidMessage(msg)).toBe(true);
    });

    it('should validate SESSION_CREATED message', () => {
        const msg = {
            ...validBase,
            type: MessageType.SESSION_CREATED,
            payload: { sessionId: 'sess-123' }
        };
        expect(MessageValidator.isValidMessage(msg)).toBe(true);
    });

    it('should validate ERROR message', () => {
        const msg = {
            ...validBase,
            type: MessageType.ERROR,
            payload: { code: 'E_FATAL', message: 'Something went wrong' }
        };
        expect(MessageValidator.isValidMessage(msg)).toBe(true);
    });

    it('should reject non-objects', () => {
        expect(MessageValidator.isValidMessage(null)).toBe(false);
        expect(MessageValidator.isValidMessage('string')).toBe(false);
        expect(MessageValidator.isValidMessage(123)).toBe(false);
        expect(MessageValidator.isValidMessage(undefined)).toBe(false);
    });

    it('should reject missing or invalid messageId', () => {
        const msg = { timestamp: Date.now(), type: MessageType.PING, payload: null };
        expect(MessageValidator.isValidMessage(msg)).toBe(false);
        
        const msgEmpty = { ...msg, messageId: '   ' };
        expect(MessageValidator.isValidMessage(msgEmpty)).toBe(false);
        
        const msgNum = { ...msg, messageId: 123 };
        expect(MessageValidator.isValidMessage(msgNum)).toBe(false);
    });

    it('should reject missing or invalid timestamp', () => {
        const msg = { messageId: '123', protocolVersion: 1, type: MessageType.PING, payload: null };
        expect(MessageValidator.isValidMessage(msg)).toBe(false);
        
        const msgStr = { ...msg, timestamp: '12345' };
        expect(MessageValidator.isValidMessage(msgStr)).toBe(false);

        const msgInf = { ...msg, timestamp: Infinity };
        expect(MessageValidator.isValidMessage(msgInf)).toBe(false);
    });

    it('should reject missing or invalid protocolVersion', () => {
        const msg = { messageId: '123', timestamp: Date.now(), type: MessageType.PING, payload: null };
        expect(MessageValidator.isValidMessage(msg)).toBe(false);

        const msgStr = { ...msg, protocolVersion: '1' };
        expect(MessageValidator.isValidMessage(msgStr)).toBe(false);

        const msgZero = { ...msg, protocolVersion: 0 };
        expect(MessageValidator.isValidMessage(msgZero)).toBe(false);

        const msgFloat = { ...msg, protocolVersion: 1.5 };
        expect(MessageValidator.isValidMessage(msgFloat)).toBe(false);
    });

    it('should validate correlationId if present', () => {
        const msgStr = { ...validBase, correlationId: 123, type: MessageType.PING, payload: null };
        expect(MessageValidator.isValidMessage(msgStr)).toBe(false);

        const msgEmpty = { ...validBase, correlationId: '   ', type: MessageType.PING, payload: null };
        expect(MessageValidator.isValidMessage(msgEmpty)).toBe(false);

        const msgValid = { ...validBase, correlationId: 'corr-123', type: MessageType.PING, payload: null };
        expect(MessageValidator.isValidMessage(msgValid)).toBe(true);
    });

    it('should reject invalid message type', () => {
        const msg = {
            ...validBase,
            type: 'UNKNOWN_TYPE',
            payload: null
        };
        expect(MessageValidator.isValidMessage(msg)).toBe(false);
    });

    it('should reject invalid payload for PING', () => {
        const msg = {
            ...validBase,
            type: MessageType.PING,
            payload: {} // should be null
        };
        expect(MessageValidator.isValidMessage(msg)).toBe(false);
    });

    it('should reject invalid payload for CREATE_SESSION', () => {
        const msg = {
            ...validBase,
            type: MessageType.CREATE_SESSION,
            payload: { wrongKey: 'ws-123' }
        };
        expect(MessageValidator.isValidMessage(msg)).toBe(false);
        
        const msgEmpty = {
            ...validBase,
            type: MessageType.CREATE_SESSION,
            payload: { workspaceId: '' }
        };
        expect(MessageValidator.isValidMessage(msgEmpty)).toBe(false);
    });

    it('should reject invalid ERROR payload', () => {
        const msgEmptyCode = {
            ...validBase,
            type: MessageType.ERROR,
            payload: { code: '', message: 'Error' }
        };
        expect(MessageValidator.isValidMessage(msgEmptyCode)).toBe(false);

        const msgEmptyMessage = {
            ...validBase,
            type: MessageType.ERROR,
            payload: { code: 'E_FATAL', message: '   ' }
        };
        expect(MessageValidator.isValidMessage(msgEmptyMessage)).toBe(false);
    });
});
