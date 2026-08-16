"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageValidator = void 0;
const MessageType_1 = require("./MessageType");
class MessageValidator {
    static isValidMessage(data) {
        if (typeof data !== 'object' || data === null) {
            return false;
        }
        const obj = data;
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
        if (typeof obj.type !== 'string' || !Object.values(MessageType_1.MessageType).includes(obj.type)) {
            return false;
        }
        return this.validatePayload(obj.type, obj.payload);
    }
    static validatePayload(type, payload) {
        switch (type) {
            case MessageType_1.MessageType.PING:
            case MessageType_1.MessageType.PONG:
                return payload === null;
            case MessageType_1.MessageType.CREATE_SESSION:
                return this.isObject(payload) && typeof payload.workspaceId === 'string' && payload.workspaceId.trim() !== '';
            case MessageType_1.MessageType.SESSION_CREATED:
            case MessageType_1.MessageType.SESSION_JOINED:
                return this.isObject(payload) &&
                    typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' &&
                    (payload.clientId === undefined || (typeof payload.clientId === 'string' && payload.clientId.trim() !== ''));
            case MessageType_1.MessageType.JOIN_SESSION:
            case MessageType_1.MessageType.LEAVE_SESSION:
            case MessageType_1.MessageType.SESSION_LEFT:
            case MessageType_1.MessageType.REQUEST_WORKSPACE_SNAPSHOT:
                return this.isObject(payload) && typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '';
            case MessageType_1.MessageType.FILE_DELETED:
                return this.isObject(payload) &&
                    typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' &&
                    typeof payload.path === 'string' && payload.path.trim() !== '' &&
                    typeof payload.baseRevision === 'number' &&
                    typeof payload.revision === 'number' &&
                    typeof payload.clientId === 'string';
            case MessageType_1.MessageType.WORKSPACE_SNAPSHOT:
                return this.isObject(payload) &&
                    typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' &&
                    typeof payload.snapshotRevision === 'number' &&
                    Array.isArray(payload.files) &&
                    payload.files.every(f => this.isObject(f) && typeof f.path === 'string' && typeof f.content === 'string');
            case MessageType_1.MessageType.FILE_CREATED:
            case MessageType_1.MessageType.FILE_CHANGED: {
                let valid = true;
                let reason = '';
                if (!this.isObject(payload)) {
                    valid = false;
                    reason = 'payload is not an object';
                }
                else if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
                    valid = false;
                    reason = 'sessionId is missing or empty';
                }
                else if (typeof payload.path !== 'string' || payload.path.trim() === '') {
                    valid = false;
                    reason = 'path is missing or empty';
                }
                else if (typeof payload.content !== 'string') {
                    valid = false;
                    reason = 'content is missing or not a string';
                }
                else if (typeof payload.baseRevision !== 'number') {
                    valid = false;
                    reason = 'baseRevision is missing or not a number';
                }
                else if (typeof payload.revision !== 'number') {
                    valid = false;
                    reason = 'revision is missing or not a number';
                }
                else if (typeof payload.clientId !== 'string') {
                    valid = false;
                    reason = 'clientId is missing or not a string';
                }
                if (type === MessageType_1.MessageType.FILE_CHANGED) {
                    console.log(`[TRACE 5] VALIDATION RESULT\ntype=FILE_CHANGED\nvalid=${valid}`);
                    if (!valid) {
                        console.log(`Failure reason: ${reason}`);
                    }
                }
                return valid;
            }
            case MessageType_1.MessageType.FILE_EDIT: {
                let valid = true;
                let reason = '';
                if (!this.isObject(payload)) {
                    valid = false;
                    reason = 'payload is not an object';
                }
                else if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
                    valid = false;
                    reason = 'sessionId is missing or empty';
                }
                else if (typeof payload.path !== 'string' || payload.path.trim() === '') {
                    valid = false;
                    reason = 'path is missing or empty';
                }
                else if (typeof payload.baseRevision !== 'number') {
                    valid = false;
                    reason = 'baseRevision is missing or not a number';
                }
                else if (typeof payload.revision !== 'number') {
                    valid = false;
                    reason = 'revision is missing or not a number';
                }
                else if (typeof payload.clientId !== 'string') {
                    valid = false;
                    reason = 'clientId is missing or not a string';
                }
                else if (!Array.isArray(payload.changes)) {
                    valid = false;
                    reason = 'changes must be an array';
                }
                else {
                    for (const change of payload.changes) {
                        if (!this.isObject(change) || typeof change.text !== 'string' || !this.isObject(change.range)) {
                            valid = false;
                            reason = 'invalid change object format';
                            break;
                        }
                        const range = change.range;
                        if (!this.isObject(range.start) || !this.isObject(range.end)) {
                            valid = false;
                            reason = 'invalid range format';
                            break;
                        }
                        if (typeof range.start.line !== 'number' || typeof range.start.character !== 'number' ||
                            typeof range.end.line !== 'number' || typeof range.end.character !== 'number') {
                            valid = false;
                            reason = 'range properties must be numbers';
                            break;
                        }
                    }
                }
                return valid;
            }
            case MessageType_1.MessageType.FILE_RENAMED:
                return this.isObject(payload) &&
                    typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' &&
                    typeof payload.oldPath === 'string' && payload.oldPath.trim() !== '' &&
                    typeof payload.newPath === 'string' && payload.newPath.trim() !== '' &&
                    typeof payload.baseRevision === 'number' &&
                    typeof payload.revision === 'number' &&
                    typeof payload.clientId === 'string';
            case MessageType_1.MessageType.REQUEST_FILE_LOCK:
            case MessageType_1.MessageType.RELEASE_FILE_LOCK:
            case MessageType_1.MessageType.FILE_UNLOCKED:
            case MessageType_1.MessageType.FILE_LOCK_HEARTBEAT:
                return this.isObject(payload) &&
                    typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' &&
                    typeof payload.path === 'string' && payload.path.trim() !== '';
            case MessageType_1.MessageType.FILE_LOCK_GRANTED:
                return this.isObject(payload) &&
                    typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' &&
                    typeof payload.path === 'string' && payload.path.trim() !== '' &&
                    typeof payload.ownerClientId === 'string' && payload.ownerClientId.trim() !== '' &&
                    typeof payload.ownerName === 'string';
            case MessageType_1.MessageType.FILE_LOCK_DENIED:
                return this.isObject(payload) &&
                    typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' &&
                    typeof payload.path === 'string' && payload.path.trim() !== '' &&
                    typeof payload.ownerClientId === 'string' && payload.ownerClientId.trim() !== '' &&
                    typeof payload.ownerName === 'string' &&
                    typeof payload.reason === 'string';
            case MessageType_1.MessageType.ERROR:
                return this.isObject(payload) &&
                    typeof payload.code === 'string' && payload.code.trim() !== '' &&
                    typeof payload.message === 'string' && payload.message.trim() !== '';
            default:
                return false;
        }
    }
    static isObject(value) {
        return typeof value === 'object' && value !== null;
    }
}
exports.MessageValidator = MessageValidator;
