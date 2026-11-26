import { BarrelExports } from './barrelExports';
import { toQuery } from './importQuery';
import { documentPathIn } from './snapshotStore';
import { attributeImport, locateDocument } from '../../core/attribution/attribute';

import type { DocumentAnalyzer } from './documentAnalyzer';
import type { LoadedTarget } from './metadataLoader';
import type { SnapshotStore } from './snapshotStore';
import type { StalenessTracker } from './staleness';
import type { TargetSelection } from './targetSelection';
import type { DocumentLocation, ImportCost, ImportQuery } from '../../core/attribution/attribute';
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

const MAX_LOAD_ROUNDS = 16;

export class ImportCostService implements vscode.Disposable {
    private readonly store: SnapshotStore;
    private readonly selection: TargetSelection;
    private readonly analyzer: DocumentAnalyzer;
    private readonly staleness: StalenessTracker;
    private readonly barrels = new BarrelExports();
    private readonly subscription: vscode.Disposable;

    public constructor(store: SnapshotStore, selection: TargetSelection, analyzer: DocumentAnalyzer, staleness: StalenessTracker) {
        this.store = store;
        this.selection = selection;
        this.analyzer = analyzer;
        this.staleness = staleness;
        this.subscription = store.onDidChange(() => this.barrels.clear());
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
        const location = this.locate(target, documentUri);
        return location === undefined ? undefined : attributeImport(location, toQuery(source), { exportsOf: this.barrels.resolver(target) });
    }

    public async costsIn(target: LoadedTarget, documentUri: vscode.Uri, analysis: DocumentAnalysis, token?: vscode.CancellationToken): Promise<(ImportCost | undefined)[]> {
        const location = this.locate(target, documentUri);
        if (location === undefined) {
            return analysis.imports.map(() => undefined);
        }
        const queries = analysis.imports.map(source => toQuery(source, analysis.usageAnalysed));
        for (let round = 0; round < MAX_LOAD_ROUNDS && token?.isCancellationRequested !== true; round++) {
            const missing = new Set<string>();
            const costs = this.attributeAll(target, location, queries, missing);
            if (missing.size === 0) {
                return costs;
            }
            await this.barrels.load(target, missing);
        }
        return this.attributeAll(target, location, queries);
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
        const costs = await this.costsIn(target, document.uri, analysis, token);
        const entries = analysis.imports.flatMap((source, index): ImportCostEntry[] => {
            const cost = costs[index];
            return cost === undefined ? [] : [{ source, cost }];
        });
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
        this.barrels.clear();
    }

    public dispose(): void {
        this.subscription.dispose();
    }

    private locate(target: LoadedTarget, documentUri: vscode.Uri): DocumentLocation | undefined {
        const path = documentPathIn(target.baseUri, documentUri);
        return path === undefined ? undefined : locateDocument(target.graph, path);
    }

    private attributeAll(target: LoadedTarget, location: DocumentLocation, queries: readonly ImportQuery[], missing?: Set<string>): ImportCost[] {
        const exportsOf = this.barrels.resolver(target, missing);
        return queries.map(query => attributeImport(location, query, { exportsOf, otherImports: queries }));
    }
}
