/**
 * Custom error class for networking related failures.
 */
export class NetworkError extends Error {
    constructor(message: string, public readonly code?: string) {
        super(message);
        this.name = 'NetworkError';
    }
}
