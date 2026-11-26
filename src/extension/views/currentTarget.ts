import * as vscode from 'vscode';

import type { ImportCostService } from '../services/importCosts';
import type { LoadedTarget } from '../services/metadataLoader';
import type { SnapshotStore } from '../services/snapshotStore';
import type { TargetSelection } from '../services/targetSelection';

export interface ResolvedTarget {
    readonly target: LoadedTarget;
    readonly containsActiveDocument: boolean;
}

export class CurrentTarget {
    private readonly store: SnapshotStore;
    private readonly selection: TargetSelection;
    private readonly service: ImportCostService;

    public constructor(store: SnapshotStore, selection: TargetSelection, service: ImportCostService) {
        this.store = store;
        this.selection = selection;
        this.service = service;
    }

    public resolve(): ResolvedTarget | undefined {
        const document = vscode.window.activeTextEditor?.document;
        const forDocument = document === undefined ? undefined : this.service.activeTargetFor(document);
        if (forDocument) {
            return { target: forDocument, containsActiveDocument: true };
        }
        const fallback = this.selection.pick(this.store.targets());
        return fallback === undefined ? undefined : { target: fallback, containsActiveDocument: false };
    }
}
