import { WebSocket } from 'ws';

export class Session {
    public readonly sessionId: string;
    public readonly workspaceId: string;
    public readonly createdAt: number;
    private readonly clients: Set<WebSocket>;
    private hostClient?: WebSocket;

    constructor(sessionId: string, workspaceId: string) {
        this.sessionId = sessionId;
        this.workspaceId = workspaceId;
        this.createdAt = Date.now();
        this.clients = new Set<WebSocket>();
    }

    public addClient(ws: WebSocket): void {
        this.clients.add(ws);
    }

    public removeClient(ws: WebSocket): void {
        this.clients.delete(ws);
    }

    public hasClient(ws: WebSocket): boolean {
        return this.clients.has(ws);
    }

    public getClientCount(): number {
        return this.clients.size;
    }

    public getClients(): WebSocket[] {
        return Array.from(this.clients);
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
