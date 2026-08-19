import * as vscode from 'vscode';
import { StartCollaborationCommand } from './StartCollaborationCommand';
import { StopCollaborationCommand } from './StopCollaborationCommand';
import { JoinCollaborationCommand } from './JoinCollaborationCommand';
import { RequestWorkspaceSnapshotCommand } from './RequestWorkspaceSnapshotCommand';
import { SessionManager } from '../collaboration/session/SessionManager';

export class CommandRegistry {
    constructor(private readonly context: vscode.ExtensionContext) {}

    public registerAll(): void {
        const sessionManager = new SessionManager({ log: (msg) => console.log(`CoForge: ${msg}`) });
        const startCollaborationCmd = new StartCollaborationCommand(sessionManager, this.context);
        const stopCollaborationCmd = new StopCollaborationCommand(sessionManager);
        const joinCollaborationCmd = new JoinCollaborationCommand(sessionManager, this.context);
        const requestSnapshotCmd = new RequestWorkspaceSnapshotCommand(sessionManager);
        
        this.context.subscriptions.push(
            vscode.commands.registerCommand(StartCollaborationCommand.ID, () => {
                return startCollaborationCmd.execute();
            }),
            vscode.commands.registerCommand(StopCollaborationCommand.ID, () => {
                return stopCollaborationCmd.execute();
            }),
            vscode.commands.registerCommand(JoinCollaborationCommand.ID, () => {
                return joinCollaborationCmd.execute();
            }),
            vscode.commands.registerCommand(RequestWorkspaceSnapshotCommand.ID, () => {
                return requestSnapshotCmd.execute();
            }),
            vscode.commands.registerCommand('coforge.requestFileEdit', () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.uri.scheme !== 'file') return;
                const sync = sessionManager.getSyncService();
                const client = sessionManager.getClient();
                const session = sessionManager.getCurrentSession();
                if (sync && client && session) {
                    const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');
                    client.requestFileLock(session.getId().toString(), relativePath);
                    vscode.window.showInformationMessage(`Requested edit lock for ${relativePath}`);
                } else {
                    vscode.window.showErrorMessage('No active collaboration session.');
                }
            }),
            vscode.commands.registerCommand('coforge.releaseFileEdit', () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.uri.scheme !== 'file') return;
                const sync = sessionManager.getSyncService();
                const client = sessionManager.getClient();
                const session = sessionManager.getCurrentSession();
                if (sync && client && session) {
                    const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');
                    client.releaseFileLock(session.getId().toString(), relativePath);
                    vscode.window.showInformationMessage(`Released edit lock for ${relativePath}`);
                } else {
                    vscode.window.showErrorMessage('No active collaboration session.');
                }
            }),
            vscode.commands.registerCommand('coforge.showFileLockStatus', () => {
                vscode.window.showInformationMessage('Lock status is displayed in the status bar for the active editor.');
            })
        );
    }
}
