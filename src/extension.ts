import * as vscode from 'vscode';
import { CoForgeApp } from './app';

let appInstance: CoForgeApp | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Activating CoForge extension...');
    
    try {
        // Delegate to the application layer to keep the entry point thin
        appInstance = new CoForgeApp(context);
        await appInstance.start();
        
        console.log('CoForge extension activated successfully.');
    } catch (error) {
        console.error('Failed to activate CoForge extension:', error);
        vscode.window.showErrorMessage(
            `CoForge failed to activate: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        throw error; // Re-throw to inform VS Code of the activation failure
    }
}

export async function deactivate(): Promise<void> {
    console.log('Deactivating CoForge extension...');
    
    if (appInstance) {
        try {
            await appInstance.stop();
        } catch (error) {
            console.error('Error during CoForge deactivation:', error);
        } finally {
            appInstance = undefined;
        }
    }
}
