import * as vscode from 'vscode';
import { SessionManager } from '../collaboration/session/SessionManager';

export class StartCollaborationCommand {
    public static readonly ID = 'coforge.startCollaboration';

    constructor(private readonly sessionManager: SessionManager) {}

    public async execute(): Promise<void> {
        if (this.sessionManager.hasActiveSession()) {
            vscode.window.showInformationMessage('A collaboration session is already active for this workspace.');
            return;
        }

        try {
            const session = await this.sessionManager.startSession();
            vscode.window.showInformationMessage(`CoForge: Collaboration session ${session.getId().toString()} has started. State: ${session.getState()}`);
        } catch (error) {
            vscode.window.showWarningMessage(`Failed to start collaboration: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
