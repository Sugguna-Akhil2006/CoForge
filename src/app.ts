import * as vscode from 'vscode';
import { CommandRegistry } from './commands/CommandRegistry';

export class CoForgeApp {
    private commandRegistry: CommandRegistry;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.commandRegistry = new CommandRegistry(context);
    }

    public async start(): Promise<void> {
        this.commandRegistry.registerAll();
        // Initialize other core components, networking, and state here
    }

    public async stop(): Promise<void> {
        // Perform cleanup (e.g., closing connections, disposing resources)
    }
}
