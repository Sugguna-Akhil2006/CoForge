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

    /**
     * Connects to the given WebSocket URL asynchronously.
     */
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
        this.log(`Connecting to ${url}...`);

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(url);
            } catch (err) {
                this.setState(ConnectionState.DISCONNECTED);
                reject(new NetworkError('Failed to instantiate WebSocket.'));
                return;
            }

            const onOpen = () => {
                this.setState(ConnectionState.CONNECTED);
                this.log('WebSocket connected successfully.');
                this.emit('connected');
                resolve();
            };

            const onError = (error: Error) => {
                this.log(`WebSocket connection error: ${error.message}`);
                if (this.state === ConnectionState.CONNECTING) {
                    this.setState(ConnectionState.DISCONNECTED);
                    this.cleanup();
                    reject(new NetworkError(`WebSocket connection failed: ${error.message}`));
                } else {
                    this.emit('error', new NetworkError(error.message));
                }
            };

            const onClose = (code: number, reason: Buffer) => {
                const wasClean = code === 1000;
                this.log(`WebSocket closed. Code: ${code}, Clean: ${wasClean}`);
                this.setState(ConnectionState.DISCONNECTED);
                this.cleanup();
                this.emit('disconnected', { code, reason: reason.toString(), wasClean });
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

            this.ws.on('open', onOpen);
            this.ws.on('error', onError);
            this.ws.on('close', onClose);
            this.ws.on('message', onMessage);
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
     * Disposes the client, closing any active connection and removing event listeners.
     */
    public dispose(): void {
        this.disconnect();
        this.removeAllListeners();
    }
}
