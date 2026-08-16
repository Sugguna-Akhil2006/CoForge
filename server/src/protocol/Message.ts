import { MessageType } from './MessageType';

export interface BaseMessage {
    messageId: string;
    correlationId?: string;
    protocolVersion: number;
    timestamp: number;
    type: MessageType;
}

export interface PingMessage extends BaseMessage {
    type: MessageType.PING;
    payload: null;
}

export interface PongMessage extends BaseMessage {
    type: MessageType.PONG;
    payload: null;
}

export interface CreateSessionMessage extends BaseMessage {
    type: MessageType.CREATE_SESSION;
    payload: {
        workspaceId: string;
    };
}

export interface SessionCreatedMessage extends BaseMessage {
    type: MessageType.SESSION_CREATED;
    payload: {
        sessionId: string;
        clientId: string;
    };
}

export interface JoinSessionMessage extends BaseMessage {
    type: MessageType.JOIN_SESSION;
    payload: {
        sessionId: string;
    };
}

export interface SessionJoinedMessage extends BaseMessage {
    type: MessageType.SESSION_JOINED;
    payload: {
        sessionId: string;
        clientId: string;
    };
}

export interface LeaveSessionMessage extends BaseMessage {
    type: MessageType.LEAVE_SESSION;
    payload: {
        sessionId: string;
    };
}

export interface SessionLeftMessage extends BaseMessage {
    type: MessageType.SESSION_LEFT;
    payload: {
        sessionId: string;
    };
}

export interface RequestWorkspaceSnapshotMessage extends BaseMessage {
    type: MessageType.REQUEST_WORKSPACE_SNAPSHOT;
    payload: {
        sessionId: string;
    };
}

export interface WorkspaceSnapshotMessage extends BaseMessage {
    type: MessageType.WORKSPACE_SNAPSHOT;
    payload: {
        sessionId: string;
        snapshotRevision: number;
        files: Array<{ path: string; content: string }>;
    };
}

export interface FileCreatedMessage extends BaseMessage {
    type: MessageType.FILE_CREATED;
    payload: {
        sessionId: string;
        path: string;
        baseRevision: number;
        revision: number;
        clientId: string;
        content: string;
    };
}

export interface FileChangedMessage extends BaseMessage {
    type: MessageType.FILE_CHANGED;
    payload: {
        sessionId: string;
        path: string;
        baseRevision: number;
        revision: number;
        clientId: string;
        content: string;
    };
}

export interface FileDeletedMessage extends BaseMessage {
    type: MessageType.FILE_DELETED;
    payload: {
        sessionId: string;
        path: string;
        baseRevision: number;
        revision: number;
        clientId: string;
    };
}

export interface FileRenamedMessage extends BaseMessage {
    type: MessageType.FILE_RENAMED;
    payload: {
        sessionId: string;
        oldPath: string;
        newPath: string;
        baseRevision: number;
        revision: number;
        clientId: string;
    };
}

export interface ErrorMessage extends BaseMessage {
    type: MessageType.ERROR;
    payload: {
        code: string;
        message: string;
    };
}

export interface FileEditMessage extends BaseMessage {
    type: MessageType.FILE_EDIT;
    payload: {
        sessionId: string;
        path: string;
        baseRevision: number;
        revision: number;
        clientId: string;
        changes: Array<{
            range: {
                start: { line: number; character: number };
                end: { line: number; character: number };
            };
            text: string;
        }>;
    };
}

export interface RequestFileLockMessage extends BaseMessage {
    type: MessageType.REQUEST_FILE_LOCK;
    payload: {
        sessionId: string;
        path: string;
    };
}

export interface FileLockGrantedMessage extends BaseMessage {
    type: MessageType.FILE_LOCK_GRANTED;
    payload: {
        sessionId: string;
        path: string;
        ownerClientId: string;
        ownerName: string;
    };
}

export interface FileLockDeniedMessage extends BaseMessage {
    type: MessageType.FILE_LOCK_DENIED;
    payload: {
        sessionId: string;
        path: string;
        ownerClientId: string;
        ownerName: string;
        reason: string;
    };
}

export interface ReleaseFileLockMessage extends BaseMessage {
    type: MessageType.RELEASE_FILE_LOCK;
    payload: {
        sessionId: string;
        path: string;
    };
}

export interface FileUnlockedMessage extends BaseMessage {
    type: MessageType.FILE_UNLOCKED;
    payload: {
        sessionId: string;
        path: string;
    };
}

export interface FileLockHeartbeatMessage extends BaseMessage {
    type: MessageType.FILE_LOCK_HEARTBEAT;
    payload: {
        sessionId: string;
        path: string;
    };
}

export interface SaveDocumentMessage extends BaseMessage {
    type: MessageType.SAVE_DOCUMENT;
    payload: {
        sessionId: string;
        path: string;
        baseRevision: number;
        content: string;
    };
}

export interface SaveRejectedMessage extends BaseMessage {
    type: MessageType.SAVE_REJECTED;
    payload: {
        sessionId: string;
        path: string;
        currentRevision: number;
        currentContent: string;
    };
}

export type Message = 
    | PingMessage 
    | PongMessage 
    | CreateSessionMessage 
    | SessionCreatedMessage 
    | JoinSessionMessage 
    | SessionJoinedMessage 
    | LeaveSessionMessage 
    | SessionLeftMessage 
    | RequestWorkspaceSnapshotMessage
    | WorkspaceSnapshotMessage
    | FileCreatedMessage
    | FileChangedMessage
    | FileDeletedMessage
    | FileRenamedMessage
    | FileEditMessage
    | RequestFileLockMessage
    | FileLockGrantedMessage
    | FileLockDeniedMessage
    | ReleaseFileLockMessage
    | FileUnlockedMessage
    | FileLockHeartbeatMessage
    | SaveDocumentMessage
    | SaveRejectedMessage
    | ErrorMessage;
