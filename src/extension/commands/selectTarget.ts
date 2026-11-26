import * as vscode from 'vscode';

import { formatBytes } from '../../core/format';

import type { SnapshotStore } from '../services/snapshotStore';
import type { TargetSelection } from '../services/targetSelection';

type TargetItem = vscode.QuickPickItem & { readonly key: string | undefined };

export async function selectTarget(store: SnapshotStore, selection: TargetSelection): Promise<void> {
    const targets = store.targets();
    if (targets.length === 0) {
        void vscode.window.showInformationMessage('True Import Cost has not found any build metadata yet.');
        return;
    }
    const selected = selection.selectedKey;
    const items: TargetItem[] = [
        {
            label: '$(sparkle) Automatic',
            description: 'per file, the first target that contains it',
            picked: selected === undefined,
            key: undefined,
        },
        ...targets.map((target): TargetItem => {
            const bundler = [target.snapshot.bundler.name, target.snapshot.bundler.version].filter(Boolean).join(' ');
            const failure = store.failureFor(target.key);
            return {
                label: `${target.key === selected ? '$(check) ' : ''}${target.id}`,
                description: `${bundler} · ${formatBytes(target.graph.totals().total)}`,
                detail: `${vscode.workspace.asRelativePath(target.source.uri)}${failure ? ` · last update failed: ${failure.error}` : ''}`,
                key: target.key,
            };
        }),
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Build target the import costs are measured against' });
    if (picked) {
        await selection.select(picked.key);
    }
}
