import * as crypto from 'crypto';

/**
 * Represents a unique, immutable collaboration session identifier.
 */
export class SessionId {
    private readonly value: string;

    private constructor(value: string) {
        this.value = value;
    }

    /**
     * Generates a new cryptographically strong session ID.
     */
    public static generate(): SessionId {
        return new SessionId(crypto.randomUUID());
    }

    /**
     * Creates a SessionId from an existing string value.
     */
    public static fromString(value: string): SessionId {
        return new SessionId(value);
    }

    /**
     * Returns the string representation of the session ID.
     */
    public toString(): string {
        return this.value;
    }

    /**
     * Compares this session ID with another for equality.
     */
    public equals(other: SessionId): boolean {
        return this.value === other.value;
    }
}
