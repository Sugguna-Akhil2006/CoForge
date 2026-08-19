import * as vscode from 'vscode';
import { SessionManager } from '../collaboration/session/SessionManager';

export class StartCollaborationCommand {
    public static readonly ID = 'coforge.startCollaboration';

    constructor(
        private readonly sessionManager: SessionManager,
        private readonly context: vscode.ExtensionContext
    ) {}

    public async execute(): Promise<void> {
        if (this.sessionManager.hasActiveSession()) {
            vscode.window.showInformationMessage('A collaboration session is already active for this workspace.');
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
            const session = await this.sessionManager.startSession(trimmedName);
            const sessionId = session.getId().toString();
            
            const message = `CoForge: Collaboration session ${sessionId} has started. State: ${session.getState()}`;
            const copyIdAction = 'Copy Session ID';
            const copyInviteAction = 'Copy Invite';

            vscode.window.showInformationMessage(message, copyIdAction, copyInviteAction).then(selection => {
                if (selection === copyIdAction) {
                    vscode.env.clipboard.writeText(sessionId);
                    vscode.window.showInformationMessage('Session ID copied to clipboard.');
                } else if (selection === copyInviteAction) {
                    const inviteText = `Join my CoForge session:\n\nSession ID: ${sessionId}\n\nVS Code → Ctrl + Shift + P\n→ CoForge: Join Collaboration\n→ Enter the Session ID\n→ Join as your name`;
                    vscode.env.clipboard.writeText(inviteText);
                    vscode.window.showInformationMessage('Invite copied to clipboard.');
                }
            });
        } catch (error) {
            vscode.window.showWarningMessage(`Failed to start collaboration: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
