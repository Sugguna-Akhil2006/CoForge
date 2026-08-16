"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionRegistry = void 0;
const crypto = __importStar(require("crypto"));
const Session_1 = require("./Session");
const SessionError_1 = require("./SessionError");
class SessionRegistry {
    sessions = new Map();
    reverseClientMap = new Map();
    logState(context) {
        console.log(`[SESSION DEBUG] ${context}`);
        console.log(`[SESSION DEBUG] Active sessions: ${this.sessions.size}`);
        for (const [id, session] of this.sessions.entries()) {
            console.log(`[SESSION DEBUG] session=${id}, clients=${session.getClientCount()}`);
        }
        console.log(`[SESSION DEBUG] reverseClientMap size=${this.reverseClientMap.size}`);
    }
    createSession(workspaceId) {
        if (!workspaceId || workspaceId.trim() === '') {
            throw new SessionError_1.SessionError('workspaceId cannot be empty');
        }
        const sessionId = crypto.randomUUID();
        const session = new Session_1.Session(sessionId, workspaceId);
        this.sessions.set(sessionId, session);
        this.logState(`createSession - Created ${sessionId}`);
        return session;
    }
    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new SessionError_1.SessionError(`Session not found: ${sessionId}`);
        }
        return session;
    }
    hasSession(sessionId) {
        return this.sessions.has(sessionId);
    }
    addClient(sessionId, ws) {
        if (this.reverseClientMap.has(ws)) {
            throw new SessionError_1.SessionError('Client is already in a session');
        }
        const session = this.getSession(sessionId);
        if (session.hasClient(ws)) {
            throw new SessionError_1.SessionError('Client is already in the session');
        }
        const clientId = crypto.randomUUID();
        session.addClient(clientId, ws);
        this.reverseClientMap.set(ws, sessionId);
        this.logState(`addClient - Added to ${sessionId} with clientId ${clientId}`);
        return clientId;
    }
    removeClient(sessionId, ws) {
        const session = this.getSession(sessionId);
        if (!session.hasClient(ws)) {
            throw new SessionError_1.SessionError('Client is not in the session');
        }
        const clientId = session.removeClient(ws);
        this.reverseClientMap.delete(ws);
        console.log(`[SESSION DEBUG] Session ${sessionId} retained after client disconnect.`);
        this.logState(`removeClient - Removed from ${sessionId}`);
        return clientId || '';
    }
    deleteSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new SessionError_1.SessionError(`Session not found: ${sessionId}`);
        }
        for (const ws of session.getClients()) {
            this.reverseClientMap.delete(ws);
        }
        this.sessions.delete(sessionId);
        console.log(`[INFO] Session ${sessionId} deleted explicitly.`);
        this.logState(`deleteSession - Deleted ${sessionId}`);
    }
    getSessionForClient(ws) {
        const sessionId = this.reverseClientMap.get(ws);
        if (!sessionId) {
            return undefined;
        }
        return this.sessions.get(sessionId);
    }
    removeClientFromAnySession(ws) {
        const sessionId = this.reverseClientMap.get(ws);
        if (sessionId) {
            const clientId = this.removeClient(sessionId, ws);
            this.logState(`removeClientFromAnySession - Removed from ${sessionId}`);
            return { sessionId, clientId };
        }
        return undefined;
    }
}
exports.SessionRegistry = SessionRegistry;
