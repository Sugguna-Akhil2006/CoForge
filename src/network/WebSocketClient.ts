import { WebSocket } from 'ws';
import { ConnectionState } from './ConnectionState';
import { NetworkError } from './NetworkError';
import { EventEmitter } from 'events';

export interface ILogger {
    log(message: string): void;
}

/**
 * Encapsulates the WebSocket client implementation for CoForge.
 */
export class WebSocketClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private state: ConnectionState = ConnectionState.DISCONNECTED;
    public socketId: string | null = null;
    
    constructor(private readonly logger?: ILogger) {
        super();
    }

    private log(message: string): void {
        if (this.logger) {
            this.logger.log(message);
        } else {
            console.log(message);
        }
    }

    /**
     * Gets the current state of the connection.
     */
    public getState(): ConnectionState {
        return this.state;
    }

    /**
     * Checks if the WebSocket is currently connected.
     */
    public isConnected(): boolean {
        // Return true ONLY when the underlying WebSocket is actually OPEN
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    private setState(newState: ConnectionState): void {
        if (this.state !== newState) {
            this.state = newState;
            this.emit('stateChange', newState);
        }
    }

    public async connect(url: string): Promise<void> {
        if (this.state !== ConnectionState.DISCONNECTED) {
            throw new NetworkError('Cannot connect: already connected or connecting.');
        }

        try {
            new URL(url); // Validate URL
        } catch {
            throw new NetworkError('Invalid WebSocket URL provided.');
        }

        this.setState(ConnectionState.CONNECTING);
        this.log(`[WS DEBUG] connect() called`);
        this.log(`[WS DEBUG] URL = ${url}`);

        return new Promise((resolve, reject) => {
            let settled = false;
            let ws: WebSocket;

            this.log(`[WS DEBUG] creating WebSocket`);
            try {
                this.socketId = require('crypto').randomUUID();
                ws = new WebSocket(url);
                this.log(`[WS DEBUG] WebSocket object created`);
                this.log(`[WS DEBUG] readyState immediately = ${ws.readyState}`);
            } catch (err) {
                this.setState(ConnectionState.DISCONNECTED);
                reject(new NetworkError('Failed to instantiate WebSocket.'));
                return;
            }

            const timeoutId = setTimeout(() => {
                this.log(`[WS DEBUG] timeout fired`);
                this.log(`[WS DEBUG] final readyState = ${ws.readyState}`);
                if (settled) return;
                
                settled = true;
                this.setState(ConnectionState.DISCONNECTED);
                ws.removeAllListeners();
                
                try { ws.close(); } catch (e) {}
                
                reject(new NetworkError(`WebSocket connection timeout: ${url}`));
            }, 60000);

            const onOpen = () => {
                this.log(`[WS DEBUG] OPEN event received`);
                if (settled) return;
                
                clearTimeout(timeoutId);
                settled = true;

                this.ws = ws;
                this.setState(ConnectionState.CONNECTED);
                this.log(`[WS DEBUG] resolving connect promise`);
                this.emit('connected');
                resolve();
            };

            const onError = (error: any) => {
                this.log(`[WS DEBUG] ERROR event received`);
                let errorMsg = error instanceof Error ? error.message : '';
                if (!errorMsg || errorMsg.trim() === '') {
                    errorMsg = error?.code || error?.name || JSON.stringify(error) || String(error) || 'Unknown error';
                }
                
                const fullDetails = `name=${error?.name}, code=${error?.code}, message=${error?.message}, cause=${error?.cause}`;
                this.log(`[CoForge DEBUG] WebSocket ERROR: ${fullDetails} | Raw string: ${String(error)}`);
                
                if (settled) {
                    this.emit('error', new NetworkError(errorMsg));
                    return;
                }
                
                clearTimeout(timeoutId);
                settled = true;
                this.setState(ConnectionState.DISCONNECTED);
                ws.removeAllListeners();
                
                try { ws.close(); } catch (e) {}
                
                reject(new NetworkError(`WebSocket connection failed: ${errorMsg}`));
            };

            const onClose = (code: number, reason: Buffer) => {
                this.log(`[WS DEBUG] CLOSE event received`);
                const wasClean = code === 1000;
                this.log(`[CoForge DEBUG] WebSocket CLOSE: code=${code}, reason=${reason.toString()}, wasClean=${wasClean}`);
                
                if (settled) {
                    this.setState(ConnectionState.DISCONNECTED);
                    this.cleanup();
                    this.emit('disconnected', { code, reason: reason.toString(), wasClean });
                    return;
                }
                
                clearTimeout(timeoutId);
                settled = true;
                this.setState(ConnectionState.DISCONNECTED);
                ws.removeAllListeners();
                
                reject(new NetworkError(`WebSocket closed before connection established`));
            };

            const onMessage = (data: Buffer | ArrayBuffer | Buffer[] | string, isBinary: boolean) => {
                try {
                    let text = '';
                    if (typeof data === 'string') {
                        text = data;
                    } else if (Buffer.isBuffer(data)) {
                        text = data.toString('utf-8');
                    } else if (Array.isArray(data)) {
                        text = Buffer.concat(data).toString('utf-8');
                    } else {
                        text = Buffer.from(data).toString('utf-8');
                    }
                    
                    const parsed = JSON.parse(text);
                    this.emit('message', parsed);
                } catch (error) {
                    this.log('Received malformed JSON message.');
                    this.emit('error', new NetworkError('Malformed JSON message received.'));
                }
            };

            ws.on('open', onOpen);
            ws.on('error', onError);
            ws.on('close', onClose);
            ws.on('message', onMessage);
        });
    }

    /**
     * Disconnects the WebSocket gracefully.
     */
    public disconnect(): void {
        if (this.state === ConnectionState.DISCONNECTED || !this.ws) {
            return;
        }

        this.log('Disconnecting WebSocket...');
        this.ws.close(1000, 'Client disconnected intentionally');
    }

    /**
     * Sends a JSON message through the WebSocket.
     */
    public send(message: unknown): void {
        if (this.state !== ConnectionState.CONNECTED || !this.ws) {
            throw new NetworkError('Cannot send message: WebSocket is not connected.');
        }

        try {
            const data = JSON.stringify(message);
            this.ws.send(data);
        } catch (error) {
            throw new NetworkError('Failed to serialize message to JSON.');
        }
    }

    private cleanup(): void {
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws = null;
        }
    }

    /**
     * Forces immediate disconnection and resets internal state to DISCONNECTED.
     * Unlike disconnect(), this does not wait for a graceful close handshake.
     * Use this before calling connect() again for reconnection scenarios.
     */
    public forceDisconnect(): void {
        if (this.ws) {
            try {
                this.ws.close();
            } catch {
                // Ignore errors during forced cleanup
            }
            this.cleanup();
        }
        this.setState(ConnectionState.DISCONNECTED);
    }

    /**
     * Disposes the client, closing any active connection and removing event listeners.
     */
    public dispose(): void {
        this.disconnect();
        this.removeAllListeners();
    }
}
