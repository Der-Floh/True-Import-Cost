import * as vscode from 'vscode';

import { loadTarget } from '../services/metadataLoader';
import { readFolderSettings } from '../services/settings';

import type { BaselineStore } from '../services/baselineStore';
import type { LoadedTarget } from '../services/metadataLoader';
import type { CurrentTarget } from '../views/currentTarget';

export interface CompareDependencies {
    readonly current: CurrentTarget;
    readonly baselines: BaselineStore;
    readonly showDashboard: (targetKey: string) => Promise<void>;
}

export async function compareWithFile(baselines: BaselineStore, target: LoadedTarget): Promise<void> {
    const [uri] = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: false,
        defaultUri: target.source.folder.uri,
        filters: { 'Build metadata': ['json'] },
        openLabel: 'Compare',
        title: `Compare "${target.id}" with an esbuild metafile or a True Import Cost snapshot`,
    }) ?? [];
    if (!uri) {
        return;
    }
    const result = await loadTarget({ uri, folder: target.source.folder, maxBytes: readFolderSettings(target.source.folder).maxMetadataBytes });
    if (!result.ok) {
        void vscode.window.showErrorMessage(`True Import Cost cannot compare with ${vscode.workspace.asRelativePath(uri)}: ${result.error}.`);
        return;
    }
    await baselines.useSnapshot(target.key, result.target.snapshot, uri.path.slice(uri.path.lastIndexOf('/') + 1));
}

type Action = 'pin' | 'file' | 'clear';

export async function compareBuilds(dependencies: CompareDependencies): Promise<void> {
    const target = dependencies.current.resolve()?.target;
    if (!target) {
        void vscode.window.showInformationMessage('True Import Cost has not found any build metadata to compare yet.');
        return;
    }
    const existing = await dependencies.baselines.get(target.key);
    type Item = vscode.QuickPickItem & { readonly action: Action };
    const items: Item[] = [
        { label: '$(pin) Pin the current build as the baseline', description: 'later builds are compared with it', action: 'pin' },
        { label: '$(file) Compare with a metadata file…', description: 'an esbuild metafile or a snapshot', action: 'file' },
        ...(existing === undefined ? [] : [{ label: '$(close) Clear the baseline', description: existing.label, action: 'clear' as const }]),
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: `Compare builds of "${target.id}"` });
    if (!picked) {
        return;
    }
    if (picked.action === 'pin') {
        await dependencies.baselines.pin(target);
    } else if (picked.action === 'file') {
        await compareWithFile(dependencies.baselines, target);
    } else {
        await dependencies.baselines.clear(target.key);
    }
    await dependencies.showDashboard(target.key);
}
