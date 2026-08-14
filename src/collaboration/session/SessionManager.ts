import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { CollaborationSession } from './CollaborationSession';
import { SessionId } from './SessionId';
import { CollaborationClient } from '../../network/CollaborationClient';
import { WorkspaceSnapshotService } from '../../workspace/WorkspaceSnapshotService';
import { WorkspaceSyncService } from '../../workspace/WorkspaceSyncService';
import { Message, RequestWorkspaceSnapshotMessage } from '../../protocol/Message';

export interface ILogger {
    log(message: string): void;
}

/**
 * Manages the collaboration session lifecycle.
 */
export class SessionManager {
    private currentSession: CollaborationSession | undefined;
    private collaborationClient: CollaborationClient | undefined;
    private workspaceSnapshot: any; // In-memory snapshot for the guest
    private syncService: WorkspaceSyncService | undefined;

    constructor(
        private readonly logger?: ILogger,
        private readonly createClient: () => CollaborationClient = () => new CollaborationClient(logger),
        private readonly serverUrl: string = 'ws://localhost:3000'
    ) {}

    private log(message: string): void {
        if (this.logger) {
            this.logger.log(message);
        } else {
            console.log(message);
        }
    }

    /**
     * Generates a stable workspace identity.
     */
    private getWorkspaceIdentity(): string {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            throw new Error('No workspace is currently open.');
        }
        
        // Generate a stable ID for the workspace based on its URI
        // Do not use absolute local filesystem path as the public session ID.
        const workspaceUri = folders[0].uri.toString();
        return crypto.createHash('sha256').update(workspaceUri).digest('hex');
    }

    /**
     * Starts a new collaboration session.
     */
    public async startSession(): Promise<CollaborationSession> {
        if (this.hasActiveSession()) {
            throw new Error('An active session already exists for this workspace.');
        }

        const workspaceId = this.getWorkspaceIdentity();
        this.currentSession = new CollaborationSession(workspaceId);
        
        try {
            this.currentSession.start();
            this.log(`[SESSION DEBUG] START SESSION - local session ID before server creation: ${this.currentSession.getId().toString()}`);
            this.log(`Session starting for workspace: ${workspaceId}`);
            
            this.collaborationClient = this.createClient();

            // Set up snapshot request handler for the host
            this.collaborationClient.on('requestWorkspaceSnapshot', async (message: Message) => {
                this.log('[INFO] Workspace snapshot requested.');
                try {
                    const snapshotService = new WorkspaceSnapshotService(this.logger);
                    const files = await snapshotService.buildSnapshot();
                    console.log(`[DEBUG HOST] Snapshot file count: ${files.length}`);
                    console.log(`[DEBUG HOST] Snapshot files: ${files.slice(0, 10).map(f => f.path).join(', ')}`);
                    
                    if (this.collaborationClient && message.messageId) {
                        const reqMsg = message as RequestWorkspaceSnapshotMessage;
                        this.log('[INFO] Sending workspace snapshot.');
                        this.collaborationClient.sendWorkspaceSnapshot(reqMsg.payload.sessionId, files, message.messageId);
                    }
                } catch (error) {
                    this.log(`[ERROR] Failed to process snapshot request: ${error}`);
                }
            });

            await this.collaborationClient.connect(this.serverUrl);
            await this.collaborationClient.ping(5000);
            
            const serverSessionId = await this.collaborationClient.createSession(workspaceId, 5000);
            this.log(`[SESSION DEBUG] START SESSION - server returned session ID: ${serverSessionId}`);
            this.currentSession.setId(SessionId.fromString(serverSessionId));
            this.log(`[SESSION DEBUG] START SESSION - local session ID after setId(): ${this.currentSession.getId().toString()}`);
            
            this.currentSession.activate();
            this.log(`Session ${this.currentSession.getId().toString()} is now active.`);

            // Start live sync service for the host
            this.syncService = new WorkspaceSyncService(serverSessionId, this.collaborationClient, this.logger);
            this.syncService.start();

            return this.currentSession;
        } catch (error) {
            this.currentSession.fail(error instanceof Error ? error : new Error(String(error)));
            this.log(`Session failed to start: ${error}`);
            
            if (this.collaborationClient) {
                this.collaborationClient.dispose();
                this.collaborationClient = undefined;
            }
            this.currentSession = undefined;
            
            throw error;
        }
    }

    /**
     * Joins an existing collaboration session.
     */
    public async joinSession(sessionId: string): Promise<void> {
        this.log(`[SESSION DEBUG] JOIN SESSION - requested session ID: ${sessionId}`);
        if (this.hasActiveSession()) {
            throw new Error('An active session already exists for this workspace.');
        }

        const clientExisted = !!this.collaborationClient;
        this.log(`[SESSION DEBUG] JOIN SESSION - whether client existed: ${clientExisted}`);

        if (!this.collaborationClient) {
            this.collaborationClient = this.createClient();
        }
        
        const clientWasConnected = this.collaborationClient.isConnected();
        this.log(`[SESSION DEBUG] JOIN SESSION - whether client was connected: ${clientWasConnected}`);
        this.log(`[SESSION DEBUG] JOIN SESSION - whether connect() was called: ${!clientWasConnected}`);

        try {
            await this.collaborationClient.joinSession(sessionId);
            this.log(`[SESSION DEBUG] JOIN SESSION - result of joinSession(): SUCCESS`);
            
            const workspaceId = this.getWorkspaceIdentity();
            this.currentSession = new CollaborationSession(workspaceId);
            this.currentSession.setId(SessionId.fromString(sessionId));
            this.currentSession.start();
            this.currentSession.activate();
            this.log(`Joined session ${sessionId} successfully.`);

            // Automatically request snapshot after joining
            this.log('[INFO] Requesting workspace snapshot...');
            try {
                const snapshotMsg = await this.collaborationClient.requestWorkspaceSnapshot(sessionId, 15000);
                this.workspaceSnapshot = snapshotMsg.payload.files;
                this.log('[INFO] Workspace snapshot received.');
                this.log(`[INFO] Files received: ${this.workspaceSnapshot.length}`);

                const snapshotService = new WorkspaceSnapshotService(this.logger);
                await snapshotService.applySnapshot(this.workspaceSnapshot);
                this.log('[INFO] Workspace files have been materialized into the guest workspace.');

                // Start live sync service for the guest after applying snapshot
                if (this.collaborationClient) {
                    this.syncService = new WorkspaceSyncService(sessionId, this.collaborationClient, this.logger);
                    this.syncService.start();
                }
            } catch (snapError) {
                this.log(`[ERROR] Failed to receive/apply workspace snapshot: ${snapError}`);
            }
        } catch (error) {
            this.log(`[SESSION DEBUG] JOIN SESSION - result of joinSession(): FAILED - ${error}`);
            this.log(`Failed to join session: ${error}`);
            throw error;
        }
    }

    /**
     * Gets the current session if any.
     */
    public getCurrentSession(): CollaborationSession | undefined {
        return this.currentSession;
    }

    /**
     * Checks if there is an active session.
     */
    public hasActiveSession(): boolean {
        return this.currentSession !== undefined && 
            (this.currentSession.getState() === 'ACTIVE' || this.currentSession.getState() === 'STARTING');
    }

    /**
     * Stops the current session.
     */
    public async stopSession(): Promise<void> {
        if (!this.currentSession) {
            return;
        }

        try {
            this.currentSession.stop();
            this.log(`Stopping session ${this.currentSession.getId().toString()}...`);
            
            if (this.collaborationClient) {
                this.collaborationClient.disconnect();
                this.collaborationClient.dispose();
                this.collaborationClient = undefined;
            }
            
            this.currentSession.markStopped();
            this.log('Session stopped.');
        } catch (error) {
            this.currentSession.fail(error instanceof Error ? error : new Error(String(error)));
            this.log(`Error stopping session: ${error}`);
            throw error;
        } finally {
            this.currentSession = undefined;
            if (this.syncService) {
                this.syncService.dispose();
                this.syncService = undefined;
            }
            if (this.collaborationClient) {
                this.collaborationClient.disconnect();
                this.collaborationClient.dispose();
                this.collaborationClient = undefined;
            }
        }
    }
}
