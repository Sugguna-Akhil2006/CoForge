import * as vscode from 'vscode';
import { SessionManager } from '../collaboration/session/SessionManager';

export class RequestWorkspaceSnapshotCommand {
    public static readonly ID = 'coforge.requestWorkspaceSnapshot';

    constructor(private readonly sessionManager: SessionManager) {}

    public async execute(): Promise<void> {
        const session = this.sessionManager.getCurrentSession();
        if (!session) {
            vscode.window.showErrorMessage('No active CoForge session.');
            return;
        }
        
        vscode.window.showInformationMessage('Requesting Workspace Snapshot functionality is automated on join.');
        // In a fuller implementation, this could manually trigger the snapshot request.
    }
}
