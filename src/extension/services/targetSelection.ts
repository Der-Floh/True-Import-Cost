import * as vscode from 'vscode';

import type { LoadedTarget } from './metadataLoader';

const SELECTED_TARGET = 'trueImportCost.selectedTarget';

export class TargetSelection implements vscode.Disposable {
    private readonly memento: vscode.Memento;
    private readonly changed = new vscode.EventEmitter<void>();

    public readonly onDidChange: vscode.Event<void> = this.changed.event;

    public constructor(memento: vscode.Memento) {
        this.memento = memento;
    }

    public get selectedKey(): string | undefined {
        const value: unknown = this.memento.get(SELECTED_TARGET);
        return typeof value === 'string' ? value : undefined;
    }

    public async select(key: string | undefined): Promise<void> {
        await this.memento.update(SELECTED_TARGET, key);
        this.changed.fire();
    }

    public pick(candidates: readonly LoadedTarget[]): LoadedTarget | undefined {
        const selected = this.selectedKey;
        return candidates.find(target => target.key === selected) ?? candidates[0];
    }

    public dispose(): void {
        this.changed.dispose();
    }
}
