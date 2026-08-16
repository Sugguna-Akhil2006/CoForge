import { WebSocketClient, ILogger } from './WebSocketClient';
import { MessageType } from '../protocol/MessageType';
import { Message, PingMessage, PongMessage, JoinSessionMessage, SessionJoinedMessage, ErrorMessage, WorkspaceSnapshotMessage, RequestWorkspaceSnapshotMessage } from '../protocol/Message';
import { MessageValidator } from '../protocol/MessageValidator';
import { NetworkError } from './NetworkError';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { getServerUrl } from '../config';

interface PendingRequest {
    resolve: (msg: any) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
}

export class CollaborationClient extends EventEmitter {
    private client: WebSocketClient;
    private pendingRequests = new Map<string, PendingRequest>();
    private currentUrl: string = getServerUrl();
    public clientId?: string;

    private workspaceSnapshot: Array<{ path: string; content: string }> = [];

    constructor(private readonly logger?: ILogger, client?: WebSocketClient) {
        super();
        this.client = client ?? new WebSocketClient(logger);

        this.client.on('message', (data: unknown) => {
            this.handleMessage(data);
        });

        this.client.on('error', (error: NetworkError) => {
            this.log(`CollaborationClient error: ${error.message}`);
        });

        this.client.on('disconnected', (event) => {
            this.log('CollaborationClient disconnected from server.');
            this.rejectAllPendingRequests(new NetworkError('CollaborationClient disconnected from server.'));
        });
    }

    public getWorkspaceSnapshot(): Array<{ path: string; content: string }> {
        return [...this.workspaceSnapshot];
    }

    private log(message: string): void {
        if (this.logger) {
            this.logger.log(message);
        } else {
            console.log(message);
        }
    }

    private handleMessage(data: unknown): void {
        const rawMsg = data as any;
        this.log(`[CREATE TRACE] CLIENT RECEIVED\ntype=${rawMsg?.type}\nmessageId=${rawMsg?.messageId}\ncorrelationId=${rawMsg?.correlationId}`);

        if (!MessageValidator.isValidMessage(data)) {
            this.log('Received invalid protocol message from server.');
            return;
        }

        const message = data as Message;

        switch (message.type) {
            case MessageType.PONG:
                this.handleResponse(message, 'PONG');
                break;
            case MessageType.SESSION_CREATED:
                this.log(`[CREATE TRACE] SESSION_CREATED RECEIVED\nmessageId=${message.messageId}\ncorrelationId=${message.correlationId}`);
                this.handleResponse(message, 'SESSION_CREATED');
                break;
            case MessageType.SESSION_JOINED:
                this.handleResponse(message, 'SESSION_JOINED');
                break;
            case MessageType.WORKSPACE_SNAPSHOT:
                const snapshotMsg = message as WorkspaceSnapshotMessage;
                console.log(`[DEBUG GUEST] Received snapshot file count: ${snapshotMsg.payload.files.length}`);
                console.log(`[DEBUG GUEST] Received snapshot files: ${snapshotMsg.payload.files.slice(0, 10).map(f => f.path).join(', ')}`);
                this.log(`[INFO] WORKSPACE_SNAPSHOT received.`);
                this.log(`[INFO] sessionId: ${snapshotMsg.payload.sessionId}`);
                this.log(`[INFO] files received: ${snapshotMsg.payload.files.length}`);
                
                this.workspaceSnapshot = snapshotMsg.payload.files;

                if (message.correlationId) {
                    const pending = this.pendingRequests.get(message.correlationId);
                    if (pending) {
                        clearTimeout(pending.timeoutId);
                        this.pendingRequests.delete(message.correlationId);
                        pending.resolve(message);
                    }
                }
                break;
            case MessageType.REQUEST_WORKSPACE_SNAPSHOT:
                this.emit('requestWorkspaceSnapshot', message);
                return;
            case MessageType.FILE_CREATED:
                this.emit('fileCreated', message);
                break;
            case MessageType.FILE_CHANGED:
                this.log(`[TRACE 8] CLIENT B RECEIVED\ntype=FILE_CHANGED\nmessageId=${message.messageId}`);
                this.emit('fileChanged', message);
                break;
            case MessageType.FILE_EDIT:
                this.log(`[TRACE 8] CLIENT B RECEIVED\ntype=FILE_EDIT\nmessageId=${message.messageId}`);
                this.emit('fileEdit', message);
                break;
            case MessageType.FILE_DELETED:
                this.emit('fileDeleted', message);
                break;
            case MessageType.FILE_RENAMED:
                this.emit('fileRenamed', message);
                break;
            case MessageType.DOCUMENT_UPDATE:
                this.emit('documentUpdate', message);
                break;
            case MessageType.DOCUMENT_SYNC_RESPONSE:
                this.emit('documentSyncResponse', message);
                break;
            case MessageType.FILE_LOCK_GRANTED:
                this.emit('fileLockGranted', message);
                break;
            case MessageType.FILE_LOCK_DENIED:
                this.emit('fileLockDenied', message);
                break;
            case MessageType.FILE_UNLOCKED:
                this.emit('fileUnlocked', message);
                break;
            case MessageType.ERROR:
                this.handleError(message as ErrorMessage);
                break;
            default:
                this.log(`Received unhandled message type: ${message.type}`);
        }
    }

    private rejectAllPendingRequests(error: Error): void {
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timeoutId);
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }

    private handleResponse(message: Message, typeName: string): void {
        this.log(`Server responded successfully with ${typeName}.`);
        if (!message.correlationId) {
            this.log(`Received ${typeName} without correlationId. Ignoring.`);
            return;
        }
        const pending = this.pendingRequests.get(message.correlationId);
        if (pending) {
            this.log(`[CLIENT DEBUG] Resolving pending request for correlationId: ${message.correlationId}`);
            this.log(`[CREATE TRACE] REQUEST RESOLVED`);
            clearTimeout(pending.timeoutId);
            pending.resolve(message);
            this.pendingRequests.delete(message.correlationId);
        } else {
            this.log(`Received ${typeName} for unknown correlationId: ${message.correlationId}`);
        }
    }

    private handleError(message: ErrorMessage): void {
        const errorMsg = `Server error: ${message.payload.code} - ${message.payload.message}`;
        this.log(errorMsg);
        
        if (message.correlationId) {
            const pending = this.pendingRequests.get(message.correlationId);
            if (pending) {
                this.log(`[CLIENT DEBUG] Rejecting pending request due to error for correlationId: ${message.correlationId}`);
                clearTimeout(pending.timeoutId);
                pending.reject(new NetworkError(errorMsg));
                this.pendingRequests.delete(message.correlationId);
            }
        }
    }

    public async connect(url: string = getServerUrl()): Promise<void> {
        this.log(`[CLIENT DEBUG] connect() start - url=${url}`);
        this.currentUrl = url;
        await this.client.connect(url);
        this.log('[CLIENT DEBUG] connect() completed successfully.');
    }

    public isConnected(): boolean {
        return this.client.isConnected();
    }

    public disconnect(): void {
        this.log(`[CLIENT DEBUG] disconnect() called`);
        this.client.disconnect();
    }

    public async ping(timeoutMs: number = 5000): Promise<PongMessage> {
        return new Promise((resolve, reject) => {
            const messageId = crypto.randomUUID();

            const pingMsg: PingMessage = {
                messageId,
                protocolVersion: 1,
                timestamp: Date.now(),
                type: MessageType.PING,
                payload: null
            };

            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(messageId);
                reject(new NetworkError('PING request timed out.'));
            }, timeoutMs);

            this.pendingRequests.set(messageId, { resolve, reject, timeoutId });

            try {
                this.client.send(pingMsg);
                this.log(`Sent PING with messageId: ${messageId}`);
            } catch (error) {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(messageId);
                reject(error instanceof Error ? error : new NetworkError(String(error)));
            }
        });
    }

    public async createSession(workspaceId: string, timeoutMs: number = 5000): Promise<string> {
        return new Promise((resolve, reject) => {
            const messageId = crypto.randomUUID();

            const createMsg: Message = {
                messageId,
                protocolVersion: 1,
                timestamp: Date.now(),
                type: MessageType.CREATE_SESSION,
                payload: {
                    workspaceId
                }
            };

            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(messageId);
                reject(new NetworkError('CREATE_SESSION request timed out.'));
            }, timeoutMs);

            this.pendingRequests.set(messageId, { 
                resolve: (msg: any) => {
                    this.clientId = msg.payload.clientId;
                    resolve(msg.payload.sessionId);
                }, 
                reject, 
                timeoutId 
            });

            try {
                this.log(`[CREATE TRACE] CLIENT SOCKET=${this.client.socketId}`);
                this.log(`[CREATE TRACE] SEND\nmessageId=${messageId}\nsessionId=undefined\nworkspaceId=${workspaceId}\nsocketReadyState=${this.client.getState()}`);
                this.client.send(createMsg);
                this.log(`[CREATE TRACE] SENT\nmessageId=${messageId}`);
            } catch (error) {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(messageId);
                reject(error instanceof Error ? error : new NetworkError(String(error)));
            }
        });
    }

    public async joinSession(sessionId: string, timeoutMs: number = 5000): Promise<void> {
        this.log(`[CLIENT DEBUG] joinSession() start - requested sessionId: ${sessionId}`);
        if (!sessionId || sessionId.trim() === '') {
            throw new Error('Session ID cannot be empty.');
        }

        const isConn = this.isConnected();
        this.log(`[CLIENT DEBUG] isConnected before join = ${isConn}`);
        if (!isConn) {
            this.log('WebSocket disconnected. Attempting to reconnect before joining session...');
            await this.connect(this.currentUrl);
        }

        return new Promise((resolve, reject) => {
            const messageId = crypto.randomUUID();

            const joinMsg: JoinSessionMessage = {
                messageId,
                protocolVersion: 1,
                timestamp: Date.now(),
                type: MessageType.JOIN_SESSION,
                payload: {
                    sessionId
                }
            };

            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(messageId);
                reject(new NetworkError('JOIN_SESSION request timed out.'));
            }, timeoutMs);

            this.pendingRequests.set(messageId, { 
                resolve: (msg: any) => {
                    this.clientId = msg.payload.clientId;
                    resolve();
                }, 
                reject, 
                timeoutId 
            });

            try {
                this.log(`[CLIENT DEBUG] Sending JOIN_SESSION: exact sessionId='${sessionId}', exact messageId='${messageId}'`);
                this.client.send(joinMsg);
                this.log(`Sent JOIN_SESSION for session ${sessionId}`);
            } catch (error) {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(messageId);
                reject(error instanceof Error ? error : new NetworkError(String(error)));
            }
        });
    }

    public dispose(): void {
        this.rejectAllPendingRequests(new NetworkError('CollaborationClient disposed.'));
        this.client.dispose();
    }

    public async requestWorkspaceSnapshot(sessionId: string, timeoutMs: number = 10000): Promise<any> {
        this.log(`[CLIENT DEBUG] requestWorkspaceSnapshot() start - requested sessionId: ${sessionId}`);
        if (!sessionId || sessionId.trim() === '') {
            throw new Error('Session ID cannot be empty.');
        }

        const isConn = this.isConnected();
        if (!isConn) {
            this.log('WebSocket disconnected. Attempting to reconnect before requesting snapshot...');
            await this.connect(this.currentUrl);
        }

        return new Promise((resolve, reject) => {
            const messageId = crypto.randomUUID();
            const requestMsg: Message = {
                messageId,
                protocolVersion: 1,
                timestamp: Date.now(),
                type: MessageType.REQUEST_WORKSPACE_SNAPSHOT,
                payload: {
                    sessionId
                }
            };

            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(messageId);
                reject(new NetworkError('REQUEST_WORKSPACE_SNAPSHOT request timed out.'));
            }, timeoutMs);

            this.pendingRequests.set(messageId, { resolve, reject, timeoutId });

            try {
                this.log(`Sending workspace snapshot request: ${JSON.stringify(requestMsg)}`);
                this.client.send(requestMsg);
                this.log(`Sent REQUEST_WORKSPACE_SNAPSHOT for session ${sessionId}`);
            } catch (error) {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(messageId);
                reject(error instanceof Error ? error : new NetworkError(String(error)));
            }
        });
    }

    public sendWorkspaceSnapshot(sessionId: string, files: Array<{path: string, content: string}>, correlationId: string): void {
        if (!this.isConnected()) {
            this.log('[WARN] Cannot send WORKSPACE_SNAPSHOT: not connected.');
            return;
        }

        const snapshotMsg: Message = {
            messageId: crypto.randomUUID(),
            correlationId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.WORKSPACE_SNAPSHOT,
            payload: {
                sessionId,
                snapshotRevision: 0,
                files
            }
        };

        this.log(`[INFO] Preparing WORKSPACE_SNAPSHOT:
files=${files.length}`);
        
        for (let i = 0; i < Math.min(5, files.length); i++) {
            this.log(`[INFO] Snapshot file: ${files[i].path}`);
        }
        
        const payloadSize = Buffer.byteLength(JSON.stringify(snapshotMsg), 'utf8');
        this.log(`[INFO] WORKSPACE_SNAPSHOT payload size: ${payloadSize}`);
        this.log(`[INFO] Sending WORKSPACE_SNAPSHOT with ${files.length} files.`);

        console.log(`[DEBUG HOST] Sending WORKSPACE_SNAPSHOT file count: ${files.length}`);

        try {
            this.client.send(snapshotMsg);
        } catch (error) {
            this.log(`[ERROR] Failed to send WORKSPACE_SNAPSHOT: ${error}`);
        }
    }

    public sendFileCreated(sessionId: string, path: string, content: string, baseRevision: number, revision: number): void {
        if (!this.isConnected()) {
            this.log('[WARN] Cannot send FILE_CREATED: not connected.');
            return;
        }
        const msg: Message = {
            messageId: crypto.randomUUID(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.FILE_CREATED,
            payload: { sessionId, path, content, baseRevision, revision, clientId: this.clientId || 'unknown' }
        };
        try {
            this.client.send(msg);
        } catch (error) {
            this.log(`[ERROR] Failed to send FILE_CREATED: ${error}`);
        }
    }

    public sendFileChanged(sessionId: string, path: string, content: string, baseRevision: number, revision: number): void {
        if (!this.isConnected()) {
            this.log('[WARN] Cannot send FILE_CHANGED: not connected.');
            return;
        }
        const msg: Message = {
            messageId: crypto.randomUUID(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.FILE_CHANGED,
            payload: { sessionId, path, content, baseRevision, revision, clientId: this.clientId || 'unknown' }
        };
        try {
            this.log(`[TRACE 3] WEBSOCKET SEND\ntype=FILE_CHANGED\nmessageId=${msg.messageId}\nsessionId=${sessionId}\n${JSON.stringify(msg, null, 2)}`);
            this.client.send(msg);
        } catch (error) {
            this.log(`[ERROR] Failed to send FILE_CHANGED: ${error}`);
        }
    }

    public sendFileEdit(sessionId: string, path: string, baseRevision: number, revision: number, changes: Array<{ range: { start: { line: number, character: number }, end: { line: number, character: number } }, text: string }>): void {
        const messageId = crypto.randomUUID();
        const msg: Message = {
            messageId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.FILE_EDIT,
            payload: {
                sessionId,
                path,
                baseRevision,
                revision,
                clientId: this.clientId || 'unknown',
                changes
            }
        };
        try {
            this.log(`[TRACE 3] WEBSOCKET SEND\ntype=FILE_EDIT\nmessageId=${msg.messageId}\nsessionId=${sessionId}\nchanges=${changes.length}`);
            this.client.send(msg);
        } catch (error) {
            this.log(`[ERROR] Failed to send FILE_EDIT: ${error}`);
        }
    }

    public sendJoinDocument(sessionId: string, path: string): void {
        const msg: Message = {
            messageId: crypto.randomUUID(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.JOIN_DOCUMENT,
            payload: { sessionId, path }
        };
        this.client.send(msg);
    }

    public sendDocumentSyncRequest(sessionId: string, path: string, stateVector: Uint8Array): void {
        const msg: Message = {
            messageId: crypto.randomUUID(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.DOCUMENT_SYNC_REQUEST,
            payload: { 
                sessionId, 
                path, 
                stateVector: Buffer.from(stateVector).toString('base64') 
            }
        };
        this.client.send(msg);
    }

    public sendDocumentUpdate(sessionId: string, path: string, update: Uint8Array): void {
        const msg: Message = {
            messageId: crypto.randomUUID(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.DOCUMENT_UPDATE,
            payload: { 
                sessionId, 
                path, 
                update: Buffer.from(update).toString('base64') 
            }
        };
        this.client.send(msg);
    }

    public sendDocumentLeave(sessionId: string, path: string): void {
        const msg: Message = {
            messageId: crypto.randomUUID(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.DOCUMENT_LEAVE,
            payload: { sessionId, path }
        };
        this.client.send(msg);
    }

    public requestFileLock(sessionId: string, path: string): void {
        const messageId = crypto.randomUUID();
        const msg: Message = {
            messageId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.REQUEST_FILE_LOCK,
            payload: {
                sessionId,
                path
            }
        };
        this.client.send(msg);
    }

    public releaseFileLock(sessionId: string, path: string): void {
        const messageId = crypto.randomUUID();
        const msg: Message = {
            messageId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.RELEASE_FILE_LOCK,
            payload: {
                sessionId,
                path
            }
        };
        this.client.send(msg);
    }

    public sendFileLockHeartbeat(sessionId: string, path: string): void {
        const messageId = crypto.randomUUID();
        const msg: Message = {
            messageId,
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.FILE_LOCK_HEARTBEAT,
            payload: {
                sessionId,
                path
            }
        };
        this.client.send(msg);
    }

    public sendFileDeleted(sessionId: string, path: string, baseRevision: number, revision: number): void {
        if (!this.isConnected()) {
            this.log('[WARN] Cannot send FILE_DELETED: not connected.');
            return;
        }
        const msg: Message = {
            messageId: crypto.randomUUID(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.FILE_DELETED,
            payload: { sessionId, path, baseRevision, revision, clientId: this.clientId || 'unknown' }
        };
        try {
            this.client.send(msg);
        } catch (error) {
            this.log(`[ERROR] Failed to send FILE_DELETED: ${error}`);
        }
    }

    public sendFileRenamed(sessionId: string, oldPath: string, newPath: string, baseRevision: number, revision: number): void {
        if (!this.isConnected()) {
            this.log('[WARN] Cannot send FILE_RENAMED: not connected.');
            return;
        }
        const msg: Message = {
            messageId: crypto.randomUUID(),
            protocolVersion: 1,
            timestamp: Date.now(),
            type: MessageType.FILE_RENAMED,
            payload: { sessionId, oldPath, newPath, baseRevision, revision, clientId: this.clientId || 'unknown' }
        };
        try {
            this.client.send(msg);
        } catch (error) {
            this.log(`[ERROR] Failed to send FILE_RENAMED: ${error}`);
        }
    }
}
