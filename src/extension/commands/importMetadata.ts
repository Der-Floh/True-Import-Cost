import * as vscode from 'vscode';

import { loadTarget } from '../services/metadataLoader';
import { addTargetSetting, readFolderSettings } from '../services/settings';
import { relativePath } from '../../core/paths';

import type { MetadataReader } from '../services/metadataReader';

export async function importMetadata(reader: MetadataReader): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const firstFolder = folders[0];
    if (!firstFolder) {
        void vscode.window.showWarningMessage('Open the folder of your project first, so the build metadata can be tied to it.');
        return;
    }
    const [uri] = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: false,
        defaultUri: firstFolder.uri,
        filters: { 'Build metadata': ['json'] },
        openLabel: 'Import',
        title: 'Import an esbuild metafile, webpack or Rspack stats, or a True Import Cost snapshot',
    }) ?? [];
    if (!uri) {
        return;
    }

    const containing = vscode.workspace.getWorkspaceFolder(uri);
    const folder = containing ?? firstFolder;
    const result = await loadTarget({ uri, folder, maxBytes: readFolderSettings(folder).maxMetadataBytes }, reader);
    if (!result.ok) {
        void vscode.window.showErrorMessage(`True Import Cost cannot use ${vscode.workspace.asRelativePath(uri)}: ${result.error}.`);
        return;
    }

    const id = await vscode.window.showInputBox({
        title: 'Name of the build target',
        prompt: 'For example extension-host or webview',
        value: result.target.id,
        validateInput: value => (value.trim() === '' ? 'Enter a name' : undefined),
    });
    if (id === undefined) {
        return;
    }

    const metadata = containing ? relativePath(folder.uri.path, uri.path) : uri.fsPath;
    await addTargetSetting(folder, { id: id.trim(), metadata });
    const restricted = vscode.workspace.isTrusted ? '' : ' Restricted Mode ignores it until you trust this workspace.';
    void vscode.window.showInformationMessage(`Added build target "${id.trim()}" for ${metadata}.${restricted}`);
}
