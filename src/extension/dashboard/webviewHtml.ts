import * as vscode from 'vscode';

const TEMPLATE = ['media', 'dashboard.html'];
const BUNDLE = 'public';

function createNonce(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function localResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
    return [vscode.Uri.joinPath(extensionUri, BUNDLE)];
}

export async function dashboardHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, ...TEMPLATE));
    const template = new TextDecoder().decode(bytes);
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, BUNDLE, 'dashboard.js'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, BUNDLE, 'dashboard.css'));
    return template
        .replace(/%NONCE%/g, createNonce())
        .replace(/%CSP_SOURCE%/g, webview.cspSource)
        .replace(/%SCRIPT_URI%/g, scriptUri.toString())
        .replace(/%CSS_URI%/g, cssUri.toString());
}
