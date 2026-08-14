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
        files: Array<{ path: string; content: string }>;
    };
}

export interface FileCreatedMessage extends BaseMessage {
    type: MessageType.FILE_CREATED;
    payload: {
        sessionId: string;
        path: string;
        content: string;
    };
}

export interface FileChangedMessage extends BaseMessage {
    type: MessageType.FILE_CHANGED;
    payload: {
        sessionId: string;
        path: string;
        content: string;
    };
}

export interface FileDeletedMessage extends BaseMessage {
    type: MessageType.FILE_DELETED;
    payload: {
        sessionId: string;
        path: string;
    };
}

export interface FileRenamedMessage extends BaseMessage {
    type: MessageType.FILE_RENAMED;
    payload: {
        sessionId: string;
        oldPath: string;
        newPath: string;
    };
}

export interface ErrorMessage extends BaseMessage {
    type: MessageType.ERROR;
    payload: {
        code: string;
        message: string;
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
    | ErrorMessage;
