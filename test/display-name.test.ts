jest.mock('vscode', () => ({
    workspace: {
        getConfiguration: jest.fn().mockReturnValue({
            get: jest.fn().mockReturnValue('wss://coforge.onrender.com')
        })
    }
}), { virtual: true });

import { CollaborationServer } from '../server/src/server';
import { SessionRegistry } from '../server/src/collaboration/SessionRegistry';
import { WebSocket } from 'ws';
import { CollaborationClient } from '../src/network/CollaborationClient';
import { MessageType } from '../src/protocol/MessageType';
import { Session } from '../server/src/collaboration/Session';

describe('Join As Display Name and Share Session', () => {
    let server: CollaborationServer;
    let hostClient: CollaborationClient;
    let guestClient: CollaborationClient;
    let serverPort: number;

    beforeEach(async () => {
        server = new CollaborationServer();
        await server.start(0);
        serverPort = server.getPort();

        hostClient = new CollaborationClient();
        await hostClient.connect(`ws://localhost:${serverPort}`);

        guestClient = new CollaborationClient();
        await guestClient.connect(`ws://localhost:${serverPort}`);
    });

    afterEach(async () => {
        if (hostClient.isConnected()) {
            hostClient.disconnect();
            hostClient.dispose();
        }
        if (guestClient.isConnected()) {
            guestClient.disconnect();
            guestClient.dispose();
        }
        await server.stop();
    });

    it('Host can provide display name during session creation', async () => {
        const sessionId = await hostClient.createSession('test-workspace', 'AkhilHost');
        expect(sessionId).toBeDefined();

        // Check server session state directly to verify name is stored
        const anyServer = server as any;
        const sessionRegistry = anyServer.sessionRegistry as SessionRegistry;
        const session = sessionRegistry.getSession(sessionId);
        expect(session).toBeDefined();

        const clientId = session?.getClientId(anyServer.wss.clients.values().next().value); // host WS
        expect(clientId).toBeDefined();

        if (session && clientId) {
            expect(session.getClientName(clientId)).toBe('AkhilHost');
        }
    });

    it('Joiner can provide display name during session join', async () => {
        const sessionId = await hostClient.createSession('test-workspace', 'AkhilHost');
        await guestClient.joinSession(sessionId, 'TejusGuest');

        const anyServer = server as any;
        const sessionRegistry = anyServer.sessionRegistry as SessionRegistry;
        const session = sessionRegistry.getSession(sessionId);

        // guest WS is the second client
        let guestClientId;
        for (const [clientId, ws] of (session as any).clients.entries()) {
            if (clientId !== hostClient.clientId) {
                guestClientId = clientId;
            }
        }
        
        expect(guestClientId).toBeDefined();
        if (session && guestClientId) {
            expect(session.getClientName(guestClientId)).toBe('TejusGuest');
        }
    });

    it('Display name is sanitized and length-limited', async () => {
        const dirtyName = '<script>alert(1)</script>';
        const sessionId = await hostClient.createSession('test-workspace', dirtyName);
        
        const anyServer = server as any;
        const sessionRegistry = anyServer.sessionRegistry as SessionRegistry;
        const session = sessionRegistry.getSession(sessionId);
        
        if (session && hostClient.clientId) {
            const storedName = session.getClientName(hostClient.clientId);
            expect(storedName).not.toContain('<script>');
            expect(storedName).toContain('&lt;script&gt;');
            expect(storedName.length).toBeLessThanOrEqual(32);
        }
    });

    it('File lock UI uses display name', async () => {
        const sessionId = await hostClient.createSession('test-workspace', 'AkhilHost');
        await guestClient.joinSession(sessionId, 'TejusGuest');

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout waiting for file lock denied')), 2000);
            
            guestClient.on('fileLockDenied', (msg: any) => {
                try {
                    expect(msg.payload.ownerName).toBe('AkhilHost');
                    clearTimeout(timeout);
                    resolve();
                } catch (e) {
                    clearTimeout(timeout);
                    reject(e);
                }
            });

            // Host acquires lock
            hostClient.requestFileLock(sessionId, 'test.ts');

            // Wait a moment for lock to be established, then guest requests it
            setTimeout(() => {
                guestClient.requestFileLock(sessionId, 'test.ts');
            }, 100);
        });
    });

    it('Internal userId remains separate from displayName and allows same names', async () => {
        const sessionId = await hostClient.createSession('test-workspace', 'SameName');
        await guestClient.joinSession(sessionId, 'SameName');

        expect(hostClient.clientId).toBeDefined();
        expect(guestClient.clientId).toBeDefined();
        expect(hostClient.clientId).not.toBe(guestClient.clientId);

        const anyServer = server as any;
        const session = anyServer.sessionRegistry.getSession(sessionId) as Session;

        if (hostClient.clientId && guestClient.clientId) {
            expect(session.getClientName(hostClient.clientId)).toBe('SameName');
            expect(session.getClientName(guestClient.clientId)).toBe('SameName');
        }
    });

    it('Disconnect removes presence and releases lock', async () => {
        const sessionId = await hostClient.createSession('test-workspace', 'AkhilHost');
        await guestClient.joinSession(sessionId, 'TejusGuest');

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 3000);

            hostClient.on('fileUnlocked', (msg: any) => {
                try {
                    expect(msg.payload.path).toBe('test.ts');
                    clearTimeout(timeout);
                    resolve();
                } catch (e) {
                    clearTimeout(timeout);
                    reject(e);
                }
            });

            guestClient.requestFileLock(sessionId, 'test.ts');

            setTimeout(() => {
                // Now guest disconnects
                guestClient.disconnect();
            }, 200);
        });
    });
});
