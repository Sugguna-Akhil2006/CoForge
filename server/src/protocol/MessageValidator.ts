import { MessageType } from './MessageType';
import { Message } from './Message';

export class MessageValidator {
    public static isValidMessage(data: unknown): data is Message {
        if (typeof data !== 'object' || data === null) {
            return false;
        }

        const obj = data as Record<string, unknown>;

        if (typeof obj.messageId !== 'string' || obj.messageId.trim() === '') {
            return false;
        }

        if ('correlationId' in obj) {
            if (typeof obj.correlationId !== 'string' || obj.correlationId.trim() === '') {
                return false;
            }
        }

        if (typeof obj.protocolVersion !== 'number' || !Number.isInteger(obj.protocolVersion) || obj.protocolVersion <= 0) {
            return false;
        }

        if (typeof obj.timestamp !== 'number' || !Number.isFinite(obj.timestamp)) {
            return false;
        }

        if (typeof obj.type !== 'string' || !Object.values(MessageType).includes(obj.type as MessageType)) {
            return false;
        }

        return this.validatePayload(obj.type as MessageType, obj.payload);
    }

    private static validatePayload(type: MessageType, payload: unknown): boolean {
        switch (type) {
            case MessageType.PING:
            case MessageType.PONG:
                return payload === null;
            case MessageType.CREATE_SESSION:
                return this.isObject(payload) && typeof payload.workspaceId === 'string' && payload.workspaceId.trim() !== '';
            case MessageType.SESSION_CREATED:
            case MessageType.JOIN_SESSION:
            case MessageType.SESSION_JOINED:
            case MessageType.LEAVE_SESSION:
            case MessageType.SESSION_LEFT:
            case MessageType.REQUEST_WORKSPACE_SNAPSHOT:
            case MessageType.FILE_DELETED:
                return this.isObject(payload) && typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' &&
                       (type === MessageType.FILE_DELETED ? (typeof payload.path === 'string' && payload.path.trim() !== '') : true);
            case MessageType.WORKSPACE_SNAPSHOT:
                return this.isObject(payload) &&
                       typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' &&
                       Array.isArray(payload.files) &&
                       payload.files.every(f => this.isObject(f) && typeof f.path === 'string' && typeof f.content === 'string');
            case MessageType.FILE_CREATED:
            case MessageType.FILE_CHANGED: {
                let valid = true;
                let reason = '';
                
                if (!this.isObject(payload)) {
                    valid = false;
                    reason = 'payload is not an object';
                } else if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
                    valid = false;
                    reason = 'sessionId is missing or empty';
                } else if (typeof payload.path !== 'string' || payload.path.trim() === '') {
                    valid = false;
                    reason = 'path is missing or empty';
                } else if (typeof payload.content !== 'string') {
                    valid = false;
                    reason = 'content is missing or not a string';
                }
                
                if (type === MessageType.FILE_CHANGED) {
                    console.log(`[TRACE 5] VALIDATION RESULT\ntype=FILE_CHANGED\nvalid=${valid}`);
                    if (!valid) {
                        console.log(`Failure reason: ${reason}`);
                    }
                }
                return valid;
            }
            case MessageType.FILE_RENAMED:
                return this.isObject(payload) &&
                       typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' &&
                       typeof payload.oldPath === 'string' && payload.oldPath.trim() !== '' &&
                       typeof payload.newPath === 'string' && payload.newPath.trim() !== '';
            case MessageType.ERROR:
                return this.isObject(payload) && 
                       typeof payload.code === 'string' && payload.code.trim() !== '' &&
                       typeof payload.message === 'string' && payload.message.trim() !== '';
            default:
                return false;
        }
    }

    private static isObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null;
    }
}
