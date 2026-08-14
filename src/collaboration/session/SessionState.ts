/**
 * Represents the lifecycle state of a collaboration session.
 */
export enum SessionState {
    IDLE = 'IDLE',
    STARTING = 'STARTING',
    ACTIVE = 'ACTIVE',
    STOPPING = 'STOPPING',
    STOPPED = 'STOPPED',
    ERROR = 'ERROR'
}
