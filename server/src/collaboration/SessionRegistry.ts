import * as crypto from 'crypto';
import { WebSocket } from 'ws';
import { Session } from './Session';
import { SessionError } from './SessionError';

export class SessionRegistry {
    private sessions: Map<string, Session> = new Map();
    private reverseClientMap: Map<WebSocket, string> = new Map();

    public logState(context: string): void {
        console.log(`[SESSION DEBUG] ${context}`);
        console.log(`[SESSION DEBUG] Active sessions: ${this.sessions.size}`);

        for (const [id, session] of this.sessions.entries()) {
            console.log(
                `[SESSION DEBUG] session=${id}, clients=${session.getClientCount()}`
            );
        }

        console.log(`[SESSION DEBUG] reverseClientMap size=${this.reverseClientMap.size}`);
    }

    public createSession(workspaceId: string): Session {
        if (!workspaceId || workspaceId.trim() === '') {
            throw new SessionError('workspaceId cannot be empty');
        }

        const sessionId = crypto.randomUUID();
        const session = new Session(sessionId, workspaceId);
        this.sessions.set(sessionId, session);
        this.logState(`createSession - Created ${sessionId}`);
        return session;
    }

    public getSession(sessionId: string): Session {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new SessionError(`Session not found: ${sessionId}`);
        }
        return session;
    }

    public hasSession(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    public addClient(sessionId: string, ws: WebSocket): string {
        if (this.reverseClientMap.has(ws)) {
            throw new SessionError('Client is already in a session');
        }
        const session = this.getSession(sessionId);
        if (session.hasClient(ws)) {
            throw new SessionError('Client is already in the session');
        }
        const clientId = crypto.randomUUID();
        session.addClient(clientId, ws);
        this.reverseClientMap.set(ws, sessionId);
        this.logState(`addClient - Added to ${sessionId} with clientId ${clientId}`);
        return clientId;
    }

    public removeClient(sessionId: string, ws: WebSocket): string {
        const session = this.getSession(sessionId);
        if (!session.hasClient(ws)) {
            throw new SessionError('Client is not in the session');
        }
        const clientId = session.removeClient(ws);
        this.reverseClientMap.delete(ws);
        console.log(`[SESSION DEBUG] Session ${sessionId} retained after client disconnect.`);
        this.logState(`removeClient - Removed from ${sessionId}`);
        return clientId || '';
    }

    public deleteSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new SessionError(`Session not found: ${sessionId}`);
        }
        
        for (const ws of session.getClients()) {
            this.reverseClientMap.delete(ws);
        }
        this.sessions.delete(sessionId);
        console.log(`[INFO] Session ${sessionId} deleted explicitly.`);
        this.logState(`deleteSession - Deleted ${sessionId}`);
    }

    public getSessionForClient(ws: WebSocket): Session | undefined {
        const sessionId = this.reverseClientMap.get(ws);
        if (!sessionId) {
            return undefined;
        }
        return this.sessions.get(sessionId);
    }

    public removeClientFromAnySession(ws: WebSocket): { sessionId: string, clientId: string } | undefined {
        const sessionId = this.reverseClientMap.get(ws);
        if (sessionId) {
            const clientId = this.removeClient(sessionId, ws);
            this.logState(`removeClientFromAnySession - Removed from ${sessionId}`);
            return { sessionId, clientId };
        }
        return undefined;
    }
}
