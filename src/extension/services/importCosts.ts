import { toQuery } from './importQuery';
import { documentPathIn } from './snapshotStore';
import { attributeImport, locateDocument } from '../../core/attribution/attribute';

import type { DocumentAnalyzer } from './documentAnalyzer';
import type { LoadedTarget } from './metadataLoader';
import type { SnapshotStore } from './snapshotStore';
import type { StalenessTracker } from './staleness';
import type { TargetSelection } from './targetSelection';
import type { ImportCost } from '../../core/attribution/attribute';
import type { DocumentAnalysis, SourceImport } from '../../parser';
import type * as vscode from 'vscode';

export { toQuery } from './importQuery';

export interface ImportCostEntry {
    readonly source: SourceImport;
    readonly cost: ImportCost;
}

export interface DocumentCosts {
    readonly target: LoadedTarget;
    readonly otherTargets: readonly LoadedTarget[];
    readonly entries: readonly ImportCostEntry[];
    readonly analysis: DocumentAnalysis;
    readonly stale: boolean;
}

export class ImportCostService {
    private readonly store: SnapshotStore;
    private readonly selection: TargetSelection;
    private readonly analyzer: DocumentAnalyzer;
    private readonly staleness: StalenessTracker;

    public constructor(store: SnapshotStore, selection: TargetSelection, analyzer: DocumentAnalyzer, staleness: StalenessTracker) {
        this.store = store;
        this.selection = selection;
        this.analyzer = analyzer;
        this.staleness = staleness;
    }

    public targetsFor(document: vscode.TextDocument): LoadedTarget[] {
        return this.store.targetsContaining(document.uri);
    }

    public activeTargetFor(document: vscode.TextDocument): LoadedTarget | undefined {
        return this.selection.pick(this.targetsFor(document));
    }

    public importsIn(fileName: string, text: string): Promise<DocumentAnalysis> {
        return this.analyzer.importsIn(fileName, text);
    }

    public costIn(target: LoadedTarget, documentUri: vscode.Uri, source: SourceImport): ImportCost | undefined {
        const path = documentPathIn(target.baseUri, documentUri);
        const location = path === undefined ? undefined : locateDocument(target.graph, path);
        return location === undefined ? undefined : attributeImport(location, toQuery(source));
    }

    public async costsFor(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<DocumentCosts | undefined> {
        const candidates = this.targetsFor(document);
        const target = this.selection.pick(candidates);
        if (!target) {
            return undefined;
        }
        const analysis = await this.analyzer.analyze(document, token);
        if (!analysis || token.isCancellationRequested) {
            return undefined;
        }
        const stale = await this.staleness.isStale(document, target);
        const entries: ImportCostEntry[] = [];
        for (const source of analysis.imports) {
            const cost = this.costIn(target, document.uri, source);
            if (cost) {
                entries.push({ source, cost });
            }
        }
        return {
            target,
            otherTargets: candidates.filter(candidate => candidate !== target),
            entries,
            analysis,
            stale,
        };
    }

    public clear(): void {
        this.analyzer.clear();
        this.staleness.clear();
    }
}
