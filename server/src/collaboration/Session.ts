import { WebSocket } from 'ws';export interface FileLock {
    path: string;
    ownerClientId: string; // The WebSocket client ID (we'll just use an identifier or track by reference)
    ownerName: string;
    acquiredAt: number;
    lastActivityAt: number;
}

export interface FileState {
    path: string;
    exists: boolean;
    revision: number;
    lastModifiedBy: string;
    deletedAt?: number;
}

export class Session {
    public readonly sessionId: string;
    public readonly workspaceId: string;
    public readonly createdAt: number;
    // Map of client identifier -> WebSocket
    private readonly clients: Map<string, WebSocket>;
    private hostClient?: WebSocket;
    private fileStates: Map<string, FileState>;
    private activeLocks: Map<string, FileLock>;
    private documents: Map<string, string>;
    private clientNames: Map<string, string>;
    public globalRevision: number = 0;

    constructor(sessionId: string, workspaceId: string) {
        this.sessionId = sessionId;
        this.workspaceId = workspaceId;
        this.createdAt = Date.now();
        this.clients = new Map<string, WebSocket>();
        this.fileStates = new Map<string, FileState>();
        this.activeLocks = new Map<string, FileLock>();
        this.documents = new Map<string, string>();
        this.clientNames = new Map<string, string>();
    }

    public setClientName(clientId: string, name: string): void {
        this.clientNames.set(clientId, name);
    }

    public getClientName(clientId: string): string {
        return this.clientNames.get(clientId) || `User-${clientId.substring(0, 4)}`;
    }

    public getFileState(path: string): FileState | undefined {
        return this.fileStates.get(path);
    }

    public getOrCreateFileState(path: string): FileState {
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

    public incrementGlobalRevision(): number {
        this.globalRevision++;
        return this.globalRevision;
    }

    public updateFileState(path: string, exists: boolean, clientId: string): FileState {
        const state = this.getOrCreateFileState(path);
        state.exists = exists;
        state.revision = this.incrementGlobalRevision();
        state.lastModifiedBy = clientId;
        if (!exists) {
            state.deletedAt = Date.now();
            this.documents.delete(path); // Clean up doc on delete
        } else {
            state.deletedAt = undefined;
        }
        return state;
    }

    public getDocumentContent(path: string): string | undefined {
        return this.documents.get(path);
    }

    public updateDocumentContent(path: string, content: string): void {
        this.documents.set(path, content);
    }

    public removeDocument(path: string): void {
        this.documents.delete(path);
    }

    // --- Locking ---

    public getLock(path: string): FileLock | undefined {
        return this.activeLocks.get(path);
    }

    public acquireLock(path: string, clientId: string, ownerName: string): FileLock | null {
        const existing = this.activeLocks.get(path);
        if (existing) {
            if (existing.ownerClientId === clientId) {
                existing.lastActivityAt = Date.now();
                return existing;
            }
            return null; // Locked by someone else
        }
        const lock: FileLock = {
            path,
            ownerClientId: clientId,
            ownerName,
            acquiredAt: Date.now(),
            lastActivityAt: Date.now()
        };
        this.activeLocks.set(path, lock);
        return lock;
    }

    public releaseLock(path: string, clientId: string): boolean {
        const existing = this.activeLocks.get(path);
        if (existing && existing.ownerClientId === clientId) {
            this.activeLocks.delete(path);
            return true;
        }
        return false;
    }

    public refreshLock(path: string, clientId: string): boolean {
        const existing = this.activeLocks.get(path);
        if (existing && existing.ownerClientId === clientId) {
            existing.lastActivityAt = Date.now();
            return true;
        }
        return false;
    }

    public releaseAllLocksForClient(clientId: string): string[] {
        const releasedPaths: string[] = [];
        for (const [path, lock] of this.activeLocks.entries()) {
            if (lock.ownerClientId === clientId) {
                this.activeLocks.delete(path);
                releasedPaths.push(path);
            }
        }
        return releasedPaths;
    }

    public cleanStaleLocks(timeoutMs: number): string[] {
        const now = Date.now();
        const releasedPaths: string[] = [];
        for (const [path, lock] of this.activeLocks.entries()) {
            if (now - lock.lastActivityAt > timeoutMs) {
                this.activeLocks.delete(path);
                releasedPaths.push(path);
            }
        }
        return releasedPaths;
    }

    // --- Clients ---

    public addClient(clientId: string, ws: WebSocket): void {
        this.clients.set(clientId, ws);
    }

    public removeClient(ws: WebSocket): string | undefined {
        for (const [clientId, clientWs] of this.clients.entries()) {
            if (clientWs === ws) {
                this.clients.delete(clientId);
                this.clientNames.delete(clientId);
                return clientId;
            }
        }
        return undefined;
    }

    public hasClient(ws: WebSocket): boolean {
        for (const clientWs of this.clients.values()) {
            if (clientWs === ws) {
                return true;
            }
        }
        return false;
    }

    public getClientId(ws: WebSocket): string | undefined {
        for (const [clientId, clientWs] of this.clients.entries()) {
            if (clientWs === ws) {
                return clientId;
            }
        }
        return undefined;
    }

    public getClientCount(): number {
        return this.clients.size;
    }

    public getClients(): WebSocket[] {
        return Array.from(this.clients.values());
    }

    public getAllFiles(): FileState[] {
        return Array.from(this.fileStates.values());
    }

    public setHost(ws: WebSocket): void {
        this.hostClient = ws;
    }

    public getHost(): WebSocket | undefined {
        return this.hostClient;
    }

    public isHost(ws: WebSocket): boolean {
        return this.hostClient === ws;
    }
}
