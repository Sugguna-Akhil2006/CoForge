import { SessionId } from './SessionId';
import { SessionState } from './SessionState';

/**
 * Represents a single collaboration session.
 */
export class CollaborationSession {
    private id: SessionId;
    private readonly workspaceId: string;
    private readonly createdAt: Date;
    private state: SessionState;

    constructor(workspaceId: string) {
        this.id = SessionId.generate();
        this.workspaceId = workspaceId;
        this.createdAt = new Date();
        this.state = SessionState.IDLE;
    }

    /**
     * Gets the session ID.
     */
    public getId(): SessionId {
        return this.id;
    }

    /**
     * Sets the session ID (from server).
     */
    public setId(id: SessionId): void {
        this.id = id;
    }

    /**
     * Gets the workspace identity associated with this session.
     */
    public getWorkspaceId(): string {
        return this.workspaceId;
    }

    /**
     * Gets the session creation timestamp.
     */
    public getCreatedAt(): Date {
        return this.createdAt;
    }

    /**
     * Gets the current lifecycle state.
     */
    public getState(): SessionState {
        return this.state;
    }

    /**
     * Starts the session initialization.
     */
    public start(): void {
        if (this.state !== SessionState.IDLE) {
            throw new Error(`Cannot start session from state: ${this.state}`);
        }
        this.state = SessionState.STARTING;
    }

    /**
     * Marks the session as fully active.
     */
    public activate(): void {
        if (this.state !== SessionState.STARTING) {
            throw new Error(`Cannot activate session from state: ${this.state}`);
        }
        this.state = SessionState.ACTIVE;
    }

    /**
     * Begins the teardown process for the session.
     */
    public stop(): void {
        if (this.state !== SessionState.ACTIVE && this.state !== SessionState.STARTING && this.state !== SessionState.ERROR) {
             throw new Error(`Cannot stop session from state: ${this.state}`);
        }
        this.state = SessionState.STOPPING;
    }

    /**
     * Marks the session as fully stopped.
     */
    public markStopped(): void {
        if (this.state !== SessionState.STOPPING && this.state !== SessionState.ERROR) {
             throw new Error(`Cannot mark stopped from state: ${this.state}`);
        }
        this.state = SessionState.STOPPED;
    }

    /**
     * Transitions the session to an error state.
     */
    public fail(error: Error): void {
        this.state = SessionState.ERROR;
    }
}
