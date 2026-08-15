import * as vscode from 'vscode';

export const DEFAULT_SERVER_URL = 'wss://coforge.onrender.com';

export function getServerUrl(): string {
    const configuredUrl =
        vscode.workspace.getConfiguration('coforge').get<string>('serverUrl');

    const finalUrl = configuredUrl || DEFAULT_SERVER_URL;

    console.log(`[CoForge DEBUG] Configured server URL: ${configuredUrl || '(none)'}`);
    console.log(`[CoForge DEBUG] Final server URL: ${finalUrl}`);

    return finalUrl;
}
