import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { CollaborationSession } from './CollaborationSession';
import { SessionId } from './SessionId';
import { CollaborationClient } from '../../network/CollaborationClient';
import { WorkspaceSnapshotService } from '../../workspace/WorkspaceSnapshotService';
import { WorkspaceSyncService } from '../../workspace/WorkspaceSyncService';
import { Message, RequestWorkspaceSnapshotMessage } from '../../protocol/Message';
import { getServerUrl } from '../../config';

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

    // Reconnection state
    private role: 'host' | 'guest' | undefined;
    private activeSessionId: string | undefined;
    private isReconnecting = false;

    private static readonly MAX_RECONNECT_ATTEMPTS = 5;
    private static readonly BASE_RECONNECT_DELAY_MS = 1000;

    constructor(
        private readonly logger?: ILogger,
        private readonly createClient: () => CollaborationClient = () => new CollaborationClient(logger),
        private readonly serverUrl: string = getServerUrl()
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
                this.log('[SNAPSHOT DEBUG] Host receives snapshot request');
                try {
                    this.log('[SNAPSHOT DEBUG] Host generating workspace snapshot');
                    const snapshotService = new WorkspaceSnapshotService(this.logger);
                    const files = await snapshotService.buildSnapshot();
                    this.log(`[SNAPSHOT DEBUG] Host snapshot contains ${files.length} files`);
                    console.log(`[DEBUG HOST] Snapshot file count: ${files.length}`);
                    console.log(`[DEBUG HOST] Snapshot files: ${files.slice(0, 10).map(f => f.path).join(', ')}`);
                    
                    if (this.collaborationClient && message.messageId) {
                        const reqMsg = message as RequestWorkspaceSnapshotMessage;
                        this.log('[SNAPSHOT DEBUG] WORKSPACE_SNAPSHOT sent');
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

            // Track role and active session ID
            this.role = 'host';
            this.activeSessionId = serverSessionId;

            // Start live sync service for the host
            this.syncService = new WorkspaceSyncService(serverSessionId, this.collaborationClient, this.logger);
            this.syncService.start();

            return this.currentSession;
        } catch (error) {
            if (this.currentSession) {
                this.currentSession.fail(error instanceof Error ? error : new Error(String(error)));
            }
            this.log(`Session failed to start: ${error}`);
            
            if (this.collaborationClient) {
                this.collaborationClient.dispose();
                this.collaborationClient = undefined;
            }
            this.currentSession = undefined;
            this.role = undefined;
            this.activeSessionId = undefined;
            
            throw error;
        }
    }

    /**
     * Joins an existing collaboration session.
     */
    public async joinSession(sessionId: string): Promise<void> {
        this.log(`[SESSION DEBUG] JOIN SESSION - requested session ID: ${sessionId}`);
        this.log(`[CoForge DEBUG] JOIN server URL = ${this.serverUrl}`);
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

            // Track role and active session ID
            this.role = 'guest';
            this.activeSessionId = sessionId;

            // Automatically request snapshot after joining
            this.log('[SNAPSHOT DEBUG] Requesting workspace snapshot');
            this.log(`[SNAPSHOT DEBUG] Active session ID = ${sessionId}`);
            try {
                const snapshotMsg = await this.collaborationClient.requestWorkspaceSnapshot(sessionId, 15000);
                this.workspaceSnapshot = snapshotMsg.payload.files;
                this.log('[INFO] Workspace snapshot received.');
                this.log(`[SNAPSHOT DEBUG] Client received WORKSPACE_SNAPSHOT with ${this.workspaceSnapshot.length} files`);

                if (this.collaborationClient) {
                    // Start live sync service for the guest BEFORE applying snapshot to set guards
                    this.syncService = new WorkspaceSyncService(sessionId, this.collaborationClient, this.logger);
                    this.syncService.start();
                    
                    const snapshotRevision = snapshotMsg.payload.snapshotRevision || 0;
                    this.syncService.initializeRevisions(snapshotRevision, this.workspaceSnapshot.map((f: any) => f.path));

                    // Set remote-apply guards for all snapshot file paths
                    const guardedPaths: string[] = [];
                    for (const file of this.workspaceSnapshot) {
                        const relativePath = file.path.replace(/\\/g, '/');
                        this.syncService.addRemoteApplyGuard(relativePath);
                        guardedPaths.push(relativePath);
                    }

                    this.log('[SNAPSHOT DEBUG] Applying snapshot to local workspace');
                    const snapshotService = new WorkspaceSnapshotService(this.logger);
                    await snapshotService.applySnapshot(this.workspaceSnapshot);
                    this.log('[INFO] Workspace files have been materialized into the guest workspace.');

                    // Clear all guards after a brief delay to let file watcher events settle
                    setTimeout(() => {
                        for (const p of guardedPaths) {
                            if (this.syncService) {
                                this.syncService.removeRemoteApplyGuard(p);
                            }
                        }
                    }, 200);

                    // Set up disconnect listener for reconnection (guest only)
                    this.setupDisconnectHandler();
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
     * Sets up the disconnect handler for guest reconnection.
     */
    private setupDisconnectHandler(): void {
        if (!this.collaborationClient) {
            return;
        }

        this.collaborationClient.on('disconnected', () => {
            // Only attempt reconnection for guests with an active session
            if (this.role !== 'guest' || !this.activeSessionId || this.isReconnecting) {
                return;
            }
            this.log('[INFO] Guest disconnected. Will attempt reconnection...');
            this.attemptReconnect();
        });
    }

    /**
     * Attempts to reconnect a guest to an existing session with limited retries
     * and exponential backoff.
     */
    private async attemptReconnect(): Promise<void> {
        if (this.isReconnecting) {
            return;
        }
        this.isReconnecting = true;

        const sessionId = this.activeSessionId!;

        // Dispose old sync service to stop file watchers
        if (this.syncService) {
            this.syncService.dispose();
            this.syncService = undefined;
        }

        for (let attempt = 1; attempt <= SessionManager.MAX_RECONNECT_ATTEMPTS; attempt++) {
            const delayMs = SessionManager.BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt - 1);
            this.log(`[INFO] Attempting collaboration reconnect... (attempt ${attempt}/${SessionManager.MAX_RECONNECT_ATTEMPTS}, delay ${delayMs}ms)`);

            await this.delay(delayMs);

            try {
                // Clean up old client
                if (this.collaborationClient) {
                    this.collaborationClient.removeAllListeners();
                    this.collaborationClient.dispose();
                    this.collaborationClient = undefined;
                }

                // Create a fresh client and connect
                this.collaborationClient = this.createClient();
                await this.collaborationClient.connect(this.serverUrl);
                this.log('[INFO] Collaboration reconnect successful.');

                // Rejoin the same session
                await this.collaborationClient.joinSession(sessionId);
                this.log(`[INFO] Rejoined session ${sessionId}.`);

                // Request and apply workspace snapshot for resync
                await this.resyncWorkspace(sessionId);

                // Set up disconnect handler again for future disconnections
                this.setupDisconnectHandler();

                this.isReconnecting = false;
                return;
            } catch (error) {
                this.log(`[WARN] Reconnect attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);
                
                // Clean up failed client
                if (this.collaborationClient) {
                    try {
                        this.collaborationClient.removeAllListeners();
                        this.collaborationClient.dispose();
                    } catch {
                        // Ignore cleanup errors
                    }
                    this.collaborationClient = undefined;
                }
            }
        }

        // All attempts exhausted
        this.log('[ERROR] All reconnection attempts failed. Session is no longer active.');
        this.isReconnecting = false;
        
        if (this.currentSession) {
            this.currentSession.fail(new Error('Reconnection failed after maximum attempts.'));
        }
        this.currentSession = undefined;
        this.role = undefined;
        this.activeSessionId = undefined;
    }

    /**
     * Resynchronizes the guest workspace after reconnection by requesting
     * a fresh workspace snapshot from the host and applying it with
     * remote-apply guards to prevent echo.
     */
    private async resyncWorkspace(sessionId: string): Promise<void> {
        if (!this.collaborationClient) {
            throw new Error('Cannot resync: no collaboration client.');
        }

        this.log('[INFO] Requesting workspace snapshot for resync...');
        const snapshotMsg = await this.collaborationClient.requestWorkspaceSnapshot(sessionId, 15000);
        const files: Array<{ path: string; content: string }> = snapshotMsg.payload.files;
        this.log(`[INFO] Resync snapshot received: ${files.length} files.`);

        // Create the new sync service BEFORE applying snapshot so we can set guards
        this.syncService = new WorkspaceSyncService(sessionId, this.collaborationClient, this.logger);
        this.syncService.start();

        // Set remote-apply guards for all snapshot file paths
        const guardedPaths: string[] = [];
        for (const file of files) {
            const relativePath = file.path.replace(/\\/g, '/');
            this.syncService.addRemoteApplyGuard(relativePath);
            guardedPaths.push(relativePath);
        }

        // Apply the snapshot
        try {
            const snapshotService = new WorkspaceSnapshotService(this.logger);
            await snapshotService.applySnapshot(files);
            this.log('[INFO] Resync snapshot applied successfully.');
        } finally {
            // Clear all guards after a brief delay to let file watcher events settle
            setTimeout(() => {
                for (const p of guardedPaths) {
                    if (this.syncService) {
                        this.syncService.removeRemoteApplyGuard(p);
                    }
                }
            }, 200);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
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
            if (this.currentSession) {
                this.currentSession.fail(error instanceof Error ? error : new Error(String(error)));
            }
            this.log(`Error stopping session: ${error}`);
            throw error;
        } finally {
            this.currentSession = undefined;
            this.role = undefined;
            this.activeSessionId = undefined;
            this.isReconnecting = false;
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
