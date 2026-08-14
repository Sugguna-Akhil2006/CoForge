import * as vscode from 'vscode';
import { SessionManager } from '../collaboration/session/SessionManager';

export class StopCollaborationCommand {
    public static readonly ID = 'coforge.stopCollaboration';

    constructor(private readonly sessionManager: SessionManager) {}

    public async execute(): Promise<void> {
        if (!this.sessionManager.hasActiveSession()) {
            vscode.window.showInformationMessage('No active CoForge collaboration session.');
            return;
        }

        const session = this.sessionManager.getCurrentSession();
        const sessionId = session ? session.getId().toString() : 'unknown';

        try {
            await this.sessionManager.stopSession();
            vscode.window.showInformationMessage(`CoForge collaboration session stopped. (ID: ${sessionId})`);
        } catch (error) {
            vscode.window.showWarningMessage(`Failed to stop collaboration: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
