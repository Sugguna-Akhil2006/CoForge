"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Session = void 0;
class Session {
    sessionId;
    workspaceId;
    createdAt;
    // Map of client identifier -> WebSocket
    clients;
    hostClient;
    fileStates;
    activeLocks;
    globalRevision = 0;
    constructor(sessionId, workspaceId) {
        this.sessionId = sessionId;
        this.workspaceId = workspaceId;
        this.createdAt = Date.now();
        this.clients = new Map();
        this.fileStates = new Map();
        this.activeLocks = new Map();
    }
    getFileState(path) {
        return this.fileStates.get(path);
    }
    getOrCreateFileState(path) {
        let state = this.fileStates.get(path);
        if (!state) {
            state = {
                path,
                exists: true,
                revision: 0,
                lastModifiedBy: 'system'
            };
            this.fileStates.set(path, state);
        }
        return state;
    }
    incrementGlobalRevision() {
        this.globalRevision++;
        return this.globalRevision;
    }
    updateFileState(path, exists, clientId) {
        const state = this.getOrCreateFileState(path);
        state.exists = exists;
        state.revision = this.incrementGlobalRevision();
        state.lastModifiedBy = clientId;
        if (!exists) {
            state.deletedAt = Date.now();
        }
        else {
            state.deletedAt = undefined;
        }
        return state;
    }
    // --- Locking ---
    getLock(path) {
        return this.activeLocks.get(path);
    }
    acquireLock(path, clientId, ownerName) {
        const existing = this.activeLocks.get(path);
        if (existing) {
            if (existing.ownerClientId === clientId) {
                existing.lastActivityAt = Date.now();
                return existing;
            }
            return null; // Locked by someone else
        }
        const lock = {
            path,
            ownerClientId: clientId,
            ownerName,
            acquiredAt: Date.now(),
            lastActivityAt: Date.now()
        };
        this.activeLocks.set(path, lock);
        return lock;
    }
    releaseLock(path, clientId) {
        const existing = this.activeLocks.get(path);
        if (existing && existing.ownerClientId === clientId) {
            this.activeLocks.delete(path);
            return true;
        }
        return false;
    }
    refreshLock(path, clientId) {
        const existing = this.activeLocks.get(path);
        if (existing && existing.ownerClientId === clientId) {
            existing.lastActivityAt = Date.now();
            return true;
        }
        return false;
    }
    releaseAllLocksForClient(clientId) {
        const releasedPaths = [];
        for (const [path, lock] of this.activeLocks.entries()) {
            if (lock.ownerClientId === clientId) {
                this.activeLocks.delete(path);
                releasedPaths.push(path);
            }
        }
        return releasedPaths;
    }
    cleanStaleLocks(timeoutMs) {
        const now = Date.now();
        const releasedPaths = [];
        for (const [path, lock] of this.activeLocks.entries()) {
            if (now - lock.lastActivityAt > timeoutMs) {
                this.activeLocks.delete(path);
                releasedPaths.push(path);
            }
        }
        return releasedPaths;
    }
    // --- Clients ---
    addClient(clientId, ws) {
        this.clients.set(clientId, ws);
    }
    removeClient(ws) {
        for (const [clientId, clientWs] of this.clients.entries()) {
            if (clientWs === ws) {
                this.clients.delete(clientId);
                return clientId;
            }
        }
        return undefined;
    }
    hasClient(ws) {
        for (const clientWs of this.clients.values()) {
            if (clientWs === ws) {
                return true;
            }
        }
        return false;
    }
    getClientId(ws) {
        for (const [clientId, clientWs] of this.clients.entries()) {
            if (clientWs === ws) {
                return clientId;
            }
        }
        return undefined;
    }
    getClientCount() {
        return this.clients.size;
    }
    getClients() {
        return Array.from(this.clients.values());
    }
    getAllFiles() {
        return Array.from(this.fileStates.values());
    }
    setHost(ws) {
        this.hostClient = ws;
    }
    getHost() {
        return this.hostClient;
    }
    isHost(ws) {
        return this.hostClient === ws;
    }
}
exports.Session = Session;
