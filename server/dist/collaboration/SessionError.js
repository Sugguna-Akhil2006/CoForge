"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionError = void 0;
class SessionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SessionError';
    }
}
exports.SessionError = SessionError;
