import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { 
    Message, CreateSessionMessage, JoinSessionMessage, RequestWorkspaceSnapshotMessage, WorkspaceSnapshotMessage,
    RequestFileLockMessage, ReleaseFileLockMessage, FileLockHeartbeatMessage,
    JoinDocumentMessage, DocumentSyncRequestMessage, DocumentSyncResponseMessage, DocumentUpdateMessage, DocumentLeaveMessage
} from './protocol/Message';
import { MessageType } from './protocol/MessageType';
import { MessageValidator } from './protocol/MessageValidator';
import * as crypto from 'crypto';

import { SessionRegistry } from './collaboration/SessionRegistry';
import { Session } from './collaboration/Session';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

class CollaborationServer {
    private wss: WebSocketServer;
    private server: http.Server;
    private sessionRegistry: SessionRegistry;
    // Map to track which client requested a snapshot (messageId -> WebSocket)
    private readonly snapshotRequests = new Map<string, WebSocket>();

    constructor() {
        this.sessionRegistry = new SessionRegistry();

        this.server = http.createServer((req, res) => {
            res.writeHead(200);
            res.end('CoForge Collaboration Server\n');
        });

        this.wss = new WebSocketServer({ server: this.server });
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.wss.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
            const clientIp = request.socket.remoteAddress || 'unknown';
            console.log(`[INFO] New WebSocket connection established from ${clientIp}. Total clients: ${this.wss.clients.size}`);

            ws.on('message', (data: Buffer) => {
                this.handleMessage(ws, data);
            });

            ws.on('close', (code: number, reason: Buffer) => {
                console.log(`[INFO] WebSocket connection closed from ${clientIp}. Code: ${code}. Reason: ${reason.toString() || 'none'}`);
                const session = this.sessionRegistry.getSessionForClient(ws);
                if (session) {
                    console.log(`[SESSION DEBUG] ws.on('close') - Client was associated with session ${session.sessionId}`);
                    const removedInfo = this.sessionRegistry.removeClientFromAnySession(ws);
                    
                    if (removedInfo) {
                        const releasedPaths = session.releaseAllLocksForClient(removedInfo.clientId);
                        for (const path of releasedPaths) {
                            this.broadcastToSession(session, {
                                messageId: crypto.randomUUID(),
                                protocolVersion: 1,
                                timestamp: Date.now(),
                                type: MessageType.FILE_UNLOCKED,
                                payload: { sessionId: session.sessionId, path }
                            }, ws);
                        }
                    }

                    console.log(`[INFO] Client disconnected from session ${session.sessionId}`);
                    console.log(`[INFO] Session ${session.sessionId} retained after client disconnect.`);
                    this.sessionRegistry.logState(`ws.on('close') cleanup complete`);
                } else {
                    console.log(`[SESSION DEBUG] ws.on('close') - Client was NOT associated with any session.`);
                    this.sessionRegistry.removeClientFromAnySession(ws);
                }
            });

            ws.on('error', (error: Error) => {
                console.error(`[ERROR] WebSocket error on connection from ${clientIp}:`, error.message);
            });
        });

        this.wss.on('error', (error: Error) => {
            console.error('[ERROR] WebSocket Server error:', error.message);
        });
    }

    private handleMessage(ws: WebSocket, rawData: Buffer): void {
        try {
            const textData = rawData.toString('utf-8');
            const parsedData: unknown = JSON.parse(textData);

            if (!MessageValidator.isValidMessage(parsedData)) {
                console.warn('[WARN] Received invalid message format:', textData);
                if (typeof parsedData === 'object' && parsedData !== null && 'messageId' in parsedData && typeof (parsedData as Record<string, unknown>).messageId === 'string') {
                    const obj = parsedData as Record<string, unknown>;
                    this.sendError(ws, { messageId: obj.messageId as string, protocolVersion: typeof obj.protocolVersion === 'number' ? obj.protocolVersion : 1 } as Message, 'INVALID_MESSAGE', 'Message validation failed');
                }
                return;
            }

            const message = parsedData as Message;

            switch (message.type) {
                case MessageType.PING:
                    this.handlePing(ws, message);
                    break;
                case MessageType.PONG:
                    console.log('[INFO] Received PONG from client.');
                    break;
                case MessageType.CREATE_SESSION:
                    this.handleCreateSession(ws, message as CreateSessionMessage);
                    break;
                case MessageType.JOIN_SESSION:
                    this.handleJoinSession(ws, message as JoinSessionMessage);
                    break;
                case MessageType.REQUEST_WORKSPACE_SNAPSHOT:
                    this.handleRequestWorkspaceSnapshot(ws, message as RequestWorkspaceSnapshotMessage);
                    break;
                case MessageType.WORKSPACE_SNAPSHOT:
                    this.handleWorkspaceSnapshot(ws, message as WorkspaceSnapshotMessage);
                    break;
                case MessageType.REQUEST_FILE_LOCK:
                    this.handleRequestFileLock(ws, message as RequestFileLockMessage);
                    break;
                case MessageType.RELEASE_FILE_LOCK:
                    this.handleReleaseFileLock(ws, message as ReleaseFileLockMessage);
                    break;
                case MessageType.FILE_LOCK_HEARTBEAT:
                    this.handleFileLockHeartbeat(ws, message as FileLockHeartbeatMessage);
                    break;
                case MessageType.FILE_CREATED:
                case MessageType.FILE_CHANGED:
                case MessageType.FILE_DELETED:
                case MessageType.FILE_RENAMED:
                case MessageType.FILE_EDIT:
                    if (message.type === MessageType.FILE_CHANGED) {
                        console.log(`[TRACE 4] SERVER RECEIVED\ntype=FILE_CHANGED\nmessageId=${message.messageId}\n${JSON.stringify(message, null, 2)}`);
                    } else if (message.type === MessageType.FILE_EDIT) {
                        console.log(`[SYNC DEBUG] SERVER RECEIVED FILE_EDIT\n[SYNC DEBUG] path=${(message.payload as any).path}\n[SYNC DEBUG] baseRevision=${(message.payload as any).baseRevision}`);
                    } else {
                        console.log(`[TRACE 4] SERVER RECEIVED\ntype=${message.type}\nmessageId=${message.messageId}`);
                    }
                    this.handleFileSyncEvent(ws, message);
                    break;
                case MessageType.JOIN_DOCUMENT:
                    this.handleJoinDocument(ws, message as JoinDocumentMessage);
                    break;
                case MessageType.DOCUMENT_SYNC_REQUEST:
                    this.handleDocumentSyncRequest(ws, message as DocumentSyncRequestMessage);
                    break;
                case MessageType.DOCUMENT_SYNC_RESPONSE:
                    this.handleDocumentSyncResponse(ws, message as DocumentSyncResponseMessage);
                    break;
                case MessageType.DOCUMENT_UPDATE:
                    this.handleDocumentUpdate(ws, message as DocumentUpdateMessage);
                    break;
                case MessageType.DOCUMENT_LEAVE:
                    this.handleDocumentLeave(ws, message as DocumentLeaveMessage);
                    break;
                default:
                    console.warn(`[WARN] Unhandled message type: ${message.type}`);
            }
        } catch (error) {
            console.error('[ERROR] Failed to parse incoming message:', error instanceof Error ? error.message : String(error));
        }
    }

    private handleCreateSession(ws: WebSocket, message: CreateSessionMessage): void {
        console.log(`[INFO] Received CREATE_SESSION request (messageId: ${message.messageId}).`);
        try {
            const workspaceId = message.payload.workspaceId;
            console.log(`[CREATE TRACE] SERVER RECEIVED\nmessageId=${message.messageId}\ntype=${message.type}\nworkspaceId=${workspaceId}\nsocketOpen=${ws.readyState === WebSocket.OPEN}`);

            if (this.sessionRegistry.getSessionForClient(ws)) {
                this.sendError(ws, message, 'CLIENT_ALREADY_IN_SESSION', 'Client is already in a session.');
                return;
            }

            const session = this.sessionRegistry.createSession(workspaceId);
            const clientId = this.sessionRegistry.addClient(session.sessionId, ws);
            session.setHost(ws);

            console.log(`[INFO] Created session ${session.sessionId} for workspace ${workspaceId}. Host set. clientId: ${clientId}`);
            console.log(`[SESSION DEBUG] EXACT SESSION ID RETURNED TO CLIENT: ${session.sessionId}`);

            const response: Message = {
                messageId: crypto.randomUUID(),
                correlationId: message.messageId,
                protocolVersion: message.protocolVersion,
                timestamp: Date.now(),
                type: MessageType.SESSION_CREATED,
                payload: {
                    sessionId: session.sessionId,
                    clientId
                }
            };
            
            console.log(`[CREATE TRACE] SERVER SENDING\nrequestMessageId=${message.messageId}\nresponseMessageId=${response.messageId}\ncorrelationId=${response.correlationId}\nsessionId=${session.sessionId}`);
            this.sendMessage(ws, response);
            console.log(`[CREATE TRACE] SERVER SENT`);
        } catch (error) {
            console.error('[ERROR] Failed to create session:', error instanceof Error ? error.message : String(error));
            this.sendError(ws, message, 'CREATE_SESSION_FAILED', error instanceof Error ? error.message : 'Unknown error occurred');
        }
    }

    private handleJoinSession(ws: WebSocket, message: JoinSessionMessage): void {
        console.log(`[INFO] Received JOIN_SESSION request for sessionId: ${message.payload.sessionId} (messageId: ${message.messageId})`);
        try {
            const sessionId = message.payload.sessionId;
            
            const sessionExists = this.sessionRegistry.hasSession(sessionId);
            console.log(`[SESSION DEBUG] sessionRegistry.hasSession('${sessionId}') = ${sessionExists}`);

            if (this.sessionRegistry.getSessionForClient(ws)) {
                this.sendError(ws, message, 'CLIENT_ALREADY_IN_SESSION', 'Client is already in a session.');
                return;
            }

            if (!this.sessionRegistry.hasSession(sessionId)) {
                this.sendError(ws, message, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`);
                return;
            }

            const clientId = this.sessionRegistry.addClient(sessionId, ws);

            console.log(`[INFO] Client joined session ${sessionId} with clientId ${clientId}.`);

            const response: Message = {
                messageId: crypto.randomUUID(),
                correlationId: message.messageId,
                protocolVersion: message.protocolVersion,
                timestamp: Date.now(),
                type: MessageType.SESSION_JOINED,
                payload: {
                    sessionId,
                    clientId
                }
            };
            this.sendMessage(ws, response);
        } catch (error) {
            console.error('[ERROR] Failed to join session:', error instanceof Error ? error.message : String(error));
            this.sendError(ws, message, 'JOIN_SESSION_FAILED', error instanceof Error ? error.message : 'Unknown error occurred');
        }
    }

    private handleRequestWorkspaceSnapshot(ws: WebSocket, message: RequestWorkspaceSnapshotMessage): void {
        console.log(`[SNAPSHOT DEBUG] Snapshot request received by server`);
        console.log(`[INFO] Received REQUEST_WORKSPACE_SNAPSHOT (messageId: ${message.messageId})`);
        try {
            const sessionId = message.payload.sessionId;
            const session = this.sessionRegistry.getSession(sessionId);
            
            if (!session || !session.hasClient(ws)) {
                this.sendError(ws, message, 'NOT_IN_SESSION', 'Client does not belong to the session.');
                return;
            }

            const host = session.getHost();
            if (!host) {
                this.sendError(ws, message, 'NO_HOST', 'Session does not have an active host.');
                return;
            }

            if (session.isHost(ws)) {
                this.sendError(ws, message, 'INVALID_REQUEST', 'Host cannot request snapshot from itself.');
                return;
            }

            // Track this request so we know who to send the response to
            this.snapshotRequests.set(message.messageId, ws);

            // Forward to host
            console.log(`[SNAPSHOT DEBUG] Forwarding snapshot request to host`);
            this.sendMessage(host, message);
        } catch (error) {
            console.error('[ERROR] Failed to handle REQUEST_WORKSPACE_SNAPSHOT:', error);
            this.sendError(ws, message, 'SERVER_ERROR', 'Internal server error processing snapshot request.');
        }
    }

    private handleWorkspaceSnapshot(ws: WebSocket, message: WorkspaceSnapshotMessage): void {
        const payload = message.payload;
        console.log(`[DEBUG SERVER] Received snapshot file count: ${message.payload.files.length}`);
        console.log(`[DEBUG SERVER] Received snapshot files: ${message.payload.files.slice(0, 10).map(f => f.path).join(', ')}`);
        console.log(`[INFO] Received WORKSPACE_SNAPSHOT`);
        console.log(`[INFO] sessionId: ${payload.sessionId}`);
        console.log(`[INFO] file count: ${payload.files.length}`);
        
        for (let i = 0; i < Math.min(5, payload.files.length); i++) {
            console.log(`[INFO] Snapshot file: ${payload.files[i].path}`);
        }

        console.log(`[INFO] Received WORKSPACE_SNAPSHOT (messageId: ${message.messageId}, correlationId: ${message.correlationId})`);
        try {
            const sessionId = message.payload.sessionId;
            const session = this.sessionRegistry.getSession(sessionId);

            if (!session || !session.isHost(ws)) {
                this.sendError(ws, message, 'UNAUTHORIZED', 'Only the host can send workspace snapshots.');
                return;
            }

            if (!message.correlationId) {
                this.sendError(ws, message, 'MISSING_CORRELATION', 'Missing correlationId for snapshot response.');
                return;
            }

            const requestingClient = this.snapshotRequests.get(message.correlationId);
            if (!requestingClient) {
                this.sendError(ws, message, 'UNKNOWN_REQUEST', 'No pending request found for this snapshot.');
                return;
            }

            // Clean up the pending request
            this.snapshotRequests.delete(message.correlationId);

            // Verify requesting client is still connected and in session
            if (session.hasClient(requestingClient) && requestingClient.readyState === WebSocket.OPEN) {
                // Filter and augment snapshot based on server's authoritative state
                const authoritativeFiles = [];
                for (const file of payload.files) {
                    const state = session.getFileState(file.path);
                    if (state && !state.exists) {
                        continue; // Skip logically deleted files
                    }
                    authoritativeFiles.push(file);
                }
                
                payload.files = authoritativeFiles;
                payload.snapshotRevision = session.globalRevision;

                console.log(`[SNAPSHOT DEBUG] Server forwarding WORKSPACE_SNAPSHOT to client (Filtered count: ${authoritativeFiles.length})`);
                this.sendMessage(requestingClient, message);
                console.log(`[INFO] Forwarded WORKSPACE_SNAPSHOT to requesting guest.`);
            } else {
                console.log(`[INFO] Requesting guest for snapshot is no longer available.`);
            }
        } catch (error) {
            console.error('[ERROR] Failed to handle WORKSPACE_SNAPSHOT:', error);
            this.sendError(ws, message, 'SERVER_ERROR', 'Internal server error processing snapshot.');
        }
    }

    private handleRequestFileLock(ws: WebSocket, message: RequestFileLockMessage): void {
        const { sessionId, path } = message.payload;
        const session = this.sessionRegistry.getSession(sessionId);
        if (!session) return;
        
        const clientId = session.getClientId(ws);
        if (!clientId) return;

        const lock = session.acquireLock(path, clientId, `User-${clientId.substring(0, 4)}`);
        
        if (lock && lock.ownerClientId === clientId) {
            const granted: Message = {
                messageId: crypto.randomUUID(),
                protocolVersion: message.protocolVersion,
                timestamp: Date.now(),
                type: MessageType.FILE_LOCK_GRANTED,
                payload: { sessionId, path, ownerClientId: lock.ownerClientId, ownerName: lock.ownerName }
            };
            this.sendMessage(ws, granted);
            this.broadcastToSession(session, granted, ws);
        } else {
            const activeLock = session.getLock(path);
            const denied: Message = {
                messageId: crypto.randomUUID(),
                protocolVersion: message.protocolVersion,
                timestamp: Date.now(),
                type: MessageType.FILE_LOCK_DENIED,
                payload: { 
                    sessionId, 
                    path, 
                    ownerClientId: activeLock?.ownerClientId || 'unknown', 
                    ownerName: activeLock?.ownerName || 'Unknown User',
                    reason: 'FILE_IN_USE'
                }
            };
            this.sendMessage(ws, denied);
        }
    }

    private handleReleaseFileLock(ws: WebSocket, message: ReleaseFileLockMessage): void {
        const { sessionId, path } = message.payload;
        const session = this.sessionRegistry.getSession(sessionId);
        if (!session) return;
        
        const clientId = session.getClientId(ws);
        if (!clientId) return;

        if (session.releaseLock(path, clientId)) {
            const unlocked: Message = {
                messageId: crypto.randomUUID(),
                protocolVersion: message.protocolVersion,
                timestamp: Date.now(),
                type: MessageType.FILE_UNLOCKED,
                payload: { sessionId, path }
            };
            this.broadcastToSession(session, unlocked); // includes sender? Yes, or maybe exclude ws. Wait, sender already knows, but let's broadcast to all.
        }
    }

    private handleFileLockHeartbeat(ws: WebSocket, message: FileLockHeartbeatMessage): void {
        const { sessionId, path } = message.payload;
        const session = this.sessionRegistry.getSession(sessionId);
        if (!session) return;
        
        const clientId = session.getClientId(ws);
        if (!clientId) return;

        session.refreshLock(path, clientId);
    }

    private handleFileSyncEvent(ws: WebSocket, message: Message): void {
        const payload = message.payload as any;
        const sessionId = payload.sessionId;
        const pathStr = message.type === MessageType.FILE_RENAMED 
            ? `${payload.oldPath} -> ${payload.newPath}` 
            : payload.path;

        try {
            const session = this.sessionRegistry.getSession(sessionId);
            const senderIsMember = session ? session.hasClient(ws) : false;
            
            if (message.type === MessageType.FILE_CHANGED) {
                console.log(`[TRACE 6] SESSION CHECK\nsessionId=${sessionId}\nsenderInSession=${senderIsMember}\nclientCount=${session ? session.getClients().length : 0}`);
            }

            if (!session || !senderIsMember) {
                this.sendError(ws, message, 'UNAUTHORIZED', 'Client is not part of this session.');
                return;
            }

            const clientId = session.getClientId(ws);
            if (!clientId) return;

            const path = payload.path || payload.oldPath;
            if (!path) return;

            // Enforce Locks for FILE_EDIT and FILE_CHANGED
            if (message.type === MessageType.FILE_EDIT || message.type === MessageType.FILE_CHANGED) {
                const lock = session.getLock(path);
                if (lock && lock.ownerClientId !== clientId) {
                    this.sendError(ws, message, 'FILE_LOCKED', `File is locked by ${lock.ownerName}`);
                    return;
                }
            }

            // Enforce Revision and State
            const state = session.getFileState(path);
            const currentRev = state ? state.revision : 0;
            const baseRev = payload.baseRevision;

            if (message.type !== MessageType.FILE_CREATED && baseRev !== undefined && baseRev !== currentRev) {
                this.sendError(ws, message, 'REVISION_CONFLICT', `Revision conflict for ${path}. Expected ${currentRev}, got ${baseRev}.`);
                return;
            }

            // Update Authoritative State
            if (message.type === MessageType.FILE_DELETED) {
                session.updateFileState(path, false, clientId);
            } else if (message.type === MessageType.FILE_CREATED) {
                session.updateFileState(path, true, clientId);
            } else if (message.type === MessageType.FILE_RENAMED) {
                session.updateFileState(payload.oldPath, false, clientId);
                session.updateFileState(payload.newPath, true, clientId);
            } else {
                session.updateFileState(path, true, clientId); // FILE_EDIT / FILE_CHANGED
            }

            // Sync new revision to payload
            if (message.type === MessageType.FILE_RENAMED) {
                payload.revision = session.getFileState(payload.newPath)?.revision || 0;
            } else {
                payload.revision = session.getFileState(path)?.revision || 0;
            }

            console.log(`[INFO] ${message.type}: ${pathStr} (New Revision: ${payload.revision})`);

            // Broadcast to everyone else in the session
            this.broadcastToSession(session, message, ws);

        } catch (error) {
            console.error(`[ERROR] Failed to handle ${message.type}:`, error);
            this.sendError(ws, message, 'SERVER_ERROR', 'Internal server error processing file sync event.');
        }
    }

    private handleJoinDocument(ws: WebSocket, message: JoinDocumentMessage): void {
        const { sessionId, path } = message.payload;
        const session = this.sessionRegistry.getSession(sessionId);
        if (!session || !session.hasClient(ws)) {
            this.sendError(ws, message, 'UNAUTHORIZED', 'Client is not part of this session.');
            return;
        }

        // Initialize document if it doesn't exist
        session.getOrCreateDocument(path);
        console.log(`[INFO] Client joined document ${path} in session ${sessionId}`);
    }

    private handleDocumentSyncRequest(ws: WebSocket, message: DocumentSyncRequestMessage): void {
        const { sessionId, path, stateVector } = message.payload;
        const session = this.sessionRegistry.getSession(sessionId);
        if (!session || !session.hasClient(ws)) {
            this.sendError(ws, message, 'UNAUTHORIZED', 'Client is not part of this session.');
            return;
        }

        const doc = session.getDocument(path);
        if (!doc) {
            this.sendError(ws, message, 'NOT_FOUND', 'Document not found or not initialized.');
            return;
        }

        try {
            const clientStateVector = Buffer.from(stateVector, 'base64');
            const update = doc.encodeStateAsUpdate(clientStateVector);
            const response: Message = {
                messageId: crypto.randomUUID(),
                correlationId: message.messageId,
                protocolVersion: message.protocolVersion,
                timestamp: Date.now(),
                type: MessageType.DOCUMENT_SYNC_RESPONSE,
                payload: {
                    sessionId,
                    path,
                    update: Buffer.from(update).toString('base64')
                }
            };
            this.sendMessage(ws, response);
        } catch (err) {
            console.error(`[ERROR] Failed to process DOCUMENT_SYNC_REQUEST:`, err);
        }
    }

    private handleDocumentSyncResponse(ws: WebSocket, message: DocumentSyncResponseMessage): void {
        const { sessionId, path, update } = message.payload;
        const session = this.sessionRegistry.getSession(sessionId);
        if (!session || !session.hasClient(ws)) return;

        const doc = session.getDocument(path);
        if (doc) {
            try {
                const updateBuffer = Buffer.from(update, 'base64');
                doc.applyUpdate(updateBuffer);
            } catch (err) {
                console.error(`[ERROR] Failed to apply DOCUMENT_SYNC_RESPONSE update:`, err);
            }
        }
    }

    private handleDocumentUpdate(ws: WebSocket, message: DocumentUpdateMessage): void {
        const { sessionId, path, update } = message.payload;
        const session = this.sessionRegistry.getSession(sessionId);
        if (!session || !session.hasClient(ws)) return;

        const doc = session.getDocument(path);
        if (doc) {
            try {
                const updateBuffer = Buffer.from(update, 'base64');
                doc.applyUpdate(updateBuffer);
                // Broadcast to other clients
                this.broadcastToSession(session, message, ws);
            } catch (err) {
                console.error(`[ERROR] Failed to apply DOCUMENT_UPDATE:`, err);
            }
        }
    }

    private handleDocumentLeave(ws: WebSocket, message: DocumentLeaveMessage): void {
        // Optional: Could track per-document membership if desired
        // For now we rely on the session-level tracking
    }

    private sendError(ws: WebSocket, requestMessage: Message, code: string, errorMessage: string): void {
        const errorResponse: Message = {
            messageId: crypto.randomUUID(),
            correlationId: requestMessage.messageId,
            protocolVersion: requestMessage.protocolVersion,
            timestamp: Date.now(),
            type: MessageType.ERROR,
            payload: {
                code,
                message: errorMessage
            }
        };
        this.sendMessage(ws, errorResponse);
    }

    private handlePing(ws: WebSocket, message: Message): void {
        console.log('[INFO] Received PING. Responding with PONG.');
        const pongMessage: Message = {
            messageId: crypto.randomUUID(),
            correlationId: message.messageId,
            protocolVersion: message.protocolVersion,
            timestamp: Date.now(),
            type: MessageType.PONG,
            payload: null
        };
        this.sendMessage(ws, pongMessage);
    }

    private broadcastToSession(session: Session, message: Message, excludeWs?: WebSocket): void {
        const clients = session.getClients();
        for (const client of clients) {
            if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
                this.sendMessage(client, message);
            }
        }
    }

    private sendMessage(ws: WebSocket, message: Message): void {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
            } catch (error) {
                console.error('[ERROR] Failed to send message:', error instanceof Error ? error.message : String(error));
            }
        }
    }

    public start(port: number = PORT): void {
        this.server.listen(port, () => {
            console.log(`[INFO] CoForge Collaboration Server is listening on port ${port}`);
        });
    }

    public stop(): void {
        console.log('[INFO] Shutting down Collaboration Server...');
        for (const client of this.wss.clients) {
            this.sessionRegistry.removeClientFromAnySession(client);
            client.close();
        }
        this.wss.close(() => {
            this.server.close(() => {
                console.log('[INFO] Server stopped.');
            });
        });
    }
}

// Start the server if this file is run directly
if (require.main === module) {
    const server = new CollaborationServer();
    server.start();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n[INFO] Received SIGINT. Shutting down gracefully...');
        server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n[INFO] Received SIGTERM. Shutting down gracefully...');
        server.stop();
        process.exit(0);
    });
}

export { CollaborationServer };
