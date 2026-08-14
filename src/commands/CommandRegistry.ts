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
        const startCollaborationCmd = new StartCollaborationCommand(sessionManager);
        const stopCollaborationCmd = new StopCollaborationCommand(sessionManager);
        const joinCollaborationCmd = new JoinCollaborationCommand(sessionManager);
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
            })
        );
    }
}
