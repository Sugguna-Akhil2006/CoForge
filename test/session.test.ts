import { SessionId } from '../src/collaboration/session/SessionId';
import { SessionState } from '../src/collaboration/session/SessionState';
import { CollaborationSession } from '../src/collaboration/session/CollaborationSession';
import { SessionManager } from '../src/collaboration/session/SessionManager';
import { CollaborationClient } from '../src/network/CollaborationClient';

// Mock vscode module
const mockWorkspaceFolders = [{ uri: { toString: () => 'file:///mock/workspace' } }];
jest.mock('vscode', () => ({
    workspace: {
        get workspaceFolders() {
            return mockWorkspaceFolders;
        },
        createFileSystemWatcher: jest.fn().mockReturnValue({
            onDidCreate: jest.fn().mockReturnValue({ dispose: jest.fn() }),
            onDidChange: jest.fn().mockReturnValue({ dispose: jest.fn() }),
            onDidDelete: jest.fn().mockReturnValue({ dispose: jest.fn() }),
            dispose: jest.fn()
        }),
        getConfiguration: jest.fn().mockReturnValue({
            get: jest.fn().mockReturnValue('wss://coforge.onrender.com')
        }),
        onDidChangeTextDocument: jest.fn().mockReturnValue({ dispose: jest.fn() }),
        onDidSaveTextDocument: jest.fn().mockReturnValue({ dispose: jest.fn() }),
        onDidCreateFiles: jest.fn().mockReturnValue({ dispose: jest.fn() }),
        onDidDeleteFiles: jest.fn().mockReturnValue({ dispose: jest.fn() }),
        onDidRenameFiles: jest.fn().mockReturnValue({ dispose: jest.fn() }),
        onDidCloseTextDocument: jest.fn().mockReturnValue({ dispose: jest.fn() })
    },
    window: {
        showInformationMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        createStatusBarItem: jest.fn().mockReturnValue({
            show: jest.fn(),
            hide: jest.fn(),
            dispose: jest.fn(),
            text: '',
            backgroundColor: undefined
        }),
        onDidChangeActiveTextEditor: jest.fn().mockReturnValue({ dispose: jest.fn() })
    },
    StatusBarAlignment: {
        Left: 1,
        Right: 2
    },
    ThemeColor: jest.fn()
}), { virtual: true });

describe('SessionId', () => {
    it('should generate valid SessionId', () => {
        const id1 = SessionId.generate();
        const id2 = SessionId.generate();
        expect(id1.toString()).toBeDefined();
        expect(id1.toString().length).toBeGreaterThan(0);
        expect(id1.equals(id2)).toBe(false);
    });
});

describe('CollaborationSession', () => {
    it('should initialize correctly', () => {
        const session = new CollaborationSession('ws1');
        expect(session.getId()).toBeDefined();
        expect(session.getWorkspaceId()).toBe('ws1');
        expect(session.getState()).toBe(SessionState.IDLE);
        expect(session.getCreatedAt()).toBeInstanceOf(Date);
    });

    it('should handle normal state transitions', () => {
        const session = new CollaborationSession('ws1');
        
        session.start();
        expect(session.getState()).toBe(SessionState.STARTING);
        
        session.activate();
        expect(session.getState()).toBe(SessionState.ACTIVE);
        
        session.stop();
        expect(session.getState()).toBe(SessionState.STOPPING);
        
        session.markStopped();
        expect(session.getState()).toBe(SessionState.STOPPED);
    });

    it('should handle failure transition', () => {
        const session = new CollaborationSession('ws1');
        session.start();
        session.fail(new Error('Network error'));
        expect(session.getState()).toBe(SessionState.ERROR);
        
        // Can mark stopped from ERROR
        session.markStopped();
        expect(session.getState()).toBe(SessionState.STOPPED);
    });

    it('should fail on invalid transitions', () => {
        const session = new CollaborationSession('ws1');
        
        // Cannot activate from IDLE
        expect(() => session.activate()).toThrow();
        
        // Cannot start if already started
        session.start();
        expect(() => session.start()).toThrow();
    });
});

describe('SessionManager', () => {
    let mockLogger: any;
    let mockClient: any;
    
    const mockCreateClient = () => {
        mockClient = {
            on: jest.fn(),
            removeListener: jest.fn(),
            connect: jest.fn().mockResolvedValue(undefined),
            isConnected: jest.fn().mockReturnValue(true),
            disconnect: jest.fn(),
            ping: jest.fn().mockResolvedValue({ type: 'PONG' }),
            createSession: jest.fn().mockImplementation(() => Promise.resolve('server-session-id-' + Math.random())),
            joinSession: jest.fn().mockResolvedValue(undefined),
            requestWorkspaceSnapshot: jest.fn().mockResolvedValue({ payload: { files: [] } }),
            dispose: jest.fn()
        };
        return mockClient as unknown as CollaborationClient;
    };

    beforeEach(() => {
        // Reset mock workspace folders
        mockWorkspaceFolders.length = 0;
        mockWorkspaceFolders.push({ uri: { toString: () => 'file:///mock/workspace' } } as any);
        mockLogger = { log: jest.fn() };
    });

    it('should start session (workspace → connect → PING → PONG → ACTIVE)', async () => {
        const manager = new SessionManager(mockLogger, mockCreateClient);
        const session = await manager.startSession();
        
        expect(session.getState()).toBe(SessionState.ACTIVE);
        expect(manager.hasActiveSession()).toBe(true);
        expect(manager.getCurrentSession()).toBe(session);
        expect(mockClient.connect).toHaveBeenCalled();
        expect(mockClient.ping).toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Session starting'));
    });

    it('should prevent duplicate sessions (duplicate start)', async () => {
        const manager = new SessionManager(mockLogger, mockCreateClient);
        await manager.startSession();
        
        await expect(manager.startSession()).rejects.toThrow('An active session already exists for this workspace.');
    });

    it('should fail startup if server unavailable', async () => {
        const manager = new SessionManager(mockLogger, mockCreateClient);
        mockClient = {
            on: jest.fn(),
            removeListener: jest.fn(),
            connect: jest.fn().mockRejectedValue(new Error('Connection failed')),
            isConnected: jest.fn().mockReturnValue(false),
            disconnect: jest.fn(),
            ping: jest.fn(),
            createSession: jest.fn(),
            joinSession: jest.fn(),
            requestWorkspaceSnapshot: jest.fn(),
            dispose: jest.fn()
        };
        const failingMockCreateClient = () => mockClient as unknown as CollaborationClient;
        const failingManager = new SessionManager(mockLogger, failingMockCreateClient);

        await expect(failingManager.startSession()).rejects.toThrow('Connection failed');
        expect(failingManager.hasActiveSession()).toBe(false);
        expect(mockClient.dispose).toHaveBeenCalled();
    });

    it('should fail startup if PING timeout', async () => {
        const manager = new SessionManager(mockLogger, mockCreateClient);
        mockClient = {
            on: jest.fn(),
            removeListener: jest.fn(),
            connect: jest.fn().mockResolvedValue(undefined),
            isConnected: jest.fn().mockReturnValue(true),
            disconnect: jest.fn(),
            ping: jest.fn().mockRejectedValue(new Error('PING request timed out')),
            createSession: jest.fn(),
            joinSession: jest.fn(),
            requestWorkspaceSnapshot: jest.fn(),
            dispose: jest.fn()
        };
        const failingMockCreateClient = () => mockClient as unknown as CollaborationClient;
        const failingManager = new SessionManager(mockLogger, failingMockCreateClient);

        await expect(failingManager.startSession()).rejects.toThrow('PING request timed out');
        expect(failingManager.hasActiveSession()).toBe(false);
        expect(mockClient.dispose).toHaveBeenCalled();
    });

    it('should not throw undefined.fail if session is stopped while starting', async () => {
        let rejectConnect: (err: Error) => void;
        mockClient = {
            on: jest.fn(),
            removeListener: jest.fn(),
            connect: jest.fn().mockImplementation(() => new Promise((_, reject) => {
                rejectConnect = reject;
            })),
            isConnected: jest.fn().mockReturnValue(false),
            disconnect: jest.fn(),
            ping: jest.fn(),
            createSession: jest.fn(),
            joinSession: jest.fn(),
            requestWorkspaceSnapshot: jest.fn(),
            dispose: jest.fn()
        };
        const slowMockCreateClient = () => mockClient as unknown as CollaborationClient;
        const manager = new SessionManager(mockLogger, slowMockCreateClient);

        // Start the session, which will block on connect()
        const startPromise = manager.startSession();
        
        // Concurrently stop the session, which clears manager.currentSession
        await manager.stopSession();
        
        // Now reject the connection to trigger the catch block in startSession
        rejectConnect!(new Error('Simulated network error during start'));
        
        // The start promise should reject with the original network error, NOT a TypeError for reading 'fail' of undefined.
        await expect(startPromise).rejects.toThrow('Simulated network error during start');
    });

    it('should stop session and clean up (Successful stop)', async () => {
        const manager = new SessionManager(mockLogger, mockCreateClient);
        const session = await manager.startSession();
        
        await manager.stopSession();
        expect(manager.hasActiveSession()).toBe(false);
        expect(manager.getCurrentSession()).toBeUndefined();
        expect(session.getState()).toBe(SessionState.STOPPED);
        expect(mockClient.disconnect).toHaveBeenCalled();
        expect(mockClient.dispose).toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Session stopped'));
    });

    it('should gracefully handle stopping when no session exists', async () => {
        const manager = new SessionManager(mockLogger, mockCreateClient);
        await expect(manager.stopSession()).resolves.toBeUndefined();
        expect(manager.hasActiveSession()).toBe(false);
    });

    it('should allow starting again after stopping (Restart after successful stop)', async () => {
        const manager = new SessionManager(mockLogger, mockCreateClient);
        
        // Start and stop first session
        const firstSession = await manager.startSession();
        await manager.stopSession();
        expect(manager.hasActiveSession()).toBe(false);
        expect(firstSession.getState()).toBe(SessionState.STOPPED);
        
        // Start second session
        const secondSession = await manager.startSession();
        expect(manager.hasActiveSession()).toBe(true);
        expect(secondSession.getState()).toBe(SessionState.ACTIVE);
        expect(secondSession.getId().toString()).not.toBe(firstSession.getId().toString());
    });

    it('should allow restarting after failed startup', async () => {
        let firstCall = true;
        const retryMockCreateClient = () => {
            const client = {
                on: jest.fn(),
                removeListener: jest.fn(),
                isConnected: jest.fn().mockReturnValue(true),
                connect: jest.fn().mockImplementation(() => {
                    if (firstCall) {
                        firstCall = false;
                        return Promise.reject(new Error('Connection failed'));
                    }
                    return Promise.resolve();
                }),
                disconnect: jest.fn(),
                ping: jest.fn().mockResolvedValue({ type: 'PONG' }),
                createSession: jest.fn().mockImplementation(() => Promise.resolve('server-session-id-retry-' + Math.random())),
                joinSession: jest.fn().mockResolvedValue(undefined),
                requestWorkspaceSnapshot: jest.fn().mockResolvedValue({ payload: { files: [] } }),
                dispose: jest.fn()
            };
            mockClient = client;
            return client as unknown as CollaborationClient;
        };

        const manager = new SessionManager(mockLogger, retryMockCreateClient);

        await expect(manager.startSession()).rejects.toThrow('Connection failed');
        expect(manager.hasActiveSession()).toBe(false);

        const session = await manager.startSession();
        expect(session.getState()).toBe(SessionState.ACTIVE);
        expect(manager.hasActiveSession()).toBe(true);
    });

    it('should fail if no workspace', async () => {
        // Remove all workspaces
        mockWorkspaceFolders.length = 0;
        
        const manager = new SessionManager(mockLogger, mockCreateClient);
        await expect(manager.startSession()).rejects.toThrow('No workspace is currently open.');
    });
});
