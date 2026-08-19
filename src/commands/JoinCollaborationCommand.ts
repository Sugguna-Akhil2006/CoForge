import * as vscode from 'vscode';
import { SessionManager } from '../collaboration/session/SessionManager';

export class JoinCollaborationCommand {
    public static readonly ID = 'coforge.joinCollaboration';

    constructor(
        private readonly sessionManager: SessionManager,
        private readonly context: vscode.ExtensionContext
    ) {}

    public async execute(): Promise<void> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showErrorMessage('CoForge: Please open a workspace folder before joining a collaboration session.');
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

        let defaultName = this.context.globalState.get<string>('coforge.displayName') || '';
        const displayName = await vscode.window.showInputBox({
            prompt: 'Enter your display name',
            value: defaultName,
            ignoreFocusOut: true,
            validateInput: text => {
                const trimmed = text.trim();
                if (!trimmed) {
                    return 'Please enter a valid display name.';
                }
                if (trimmed.length > 32) {
                    return 'Display name is too long (maximum 32 characters).';
                }
                return null;
            }
        });

        if (!displayName) {
            return; // Cancelled
        }

        const trimmedName = displayName.trim();
        await this.context.globalState.update('coforge.displayName', trimmedName);

        try {
            await this.sessionManager.joinSession(sessionId, trimmedName);
            vscode.window.showInformationMessage(`Joined CoForge session ${sessionId}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to join session: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
