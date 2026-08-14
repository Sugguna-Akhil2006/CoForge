import * as vscode from 'vscode';
import { SessionManager } from '../collaboration/session/SessionManager';

export class JoinCollaborationCommand {
    public static readonly ID = 'coforge.joinCollaboration';

    constructor(private readonly sessionManager: SessionManager) {}

    public async execute(): Promise<void> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showWarningMessage('You must have a workspace open to join a CoForge session.');
            return;
        }

        const sessionId = await vscode.window.showInputBox({
            prompt: 'Enter the CoForge Session ID to join',
            placeHolder: 'e.g. 123e4567-e89b-12d3-a456-426614174000',
            ignoreFocusOut: true
        });

        if (!sessionId) {
            return;
        }

        try {
            await this.sessionManager.joinSession(sessionId);
            vscode.window.showInformationMessage(`Joined CoForge session ${sessionId}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to join session: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
