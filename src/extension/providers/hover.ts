import * as vscode from 'vscode';

import { isMeasurable } from '../measure/buildCommand';
import { measureArgumentsFor } from '../measure/importMeasurer';
import { standaloneArgumentsFor, standaloneKey } from '../measure/standaloneSizes';
import { hoverMarkdown } from '../presentation/hoverContent';
import { documentPathIn } from '../services/snapshotStore';

import type { StandaloneSizes } from '../measure/standaloneSizes';
import type { MeasurementHover } from '../presentation/measurementContent';
import type { DocumentCosts, ImportCostEntry, ImportCostService } from '../services/importCosts';
import type { MeasurementStore } from '../services/measurementStore';
import type { Settings } from '../services/settings';

export interface HoverMeasurements {
    readonly measurements: MeasurementStore;
    readonly standaloneSizes: StandaloneSizes;
}

export class ImportCostHover implements vscode.HoverProvider {
    private readonly service: ImportCostService;
    private readonly settings: () => Settings;
    private readonly stores: HoverMeasurements;

    public constructor(service: ImportCostService, settings: () => Settings, stores: HoverMeasurements) {
        this.service = service;
        this.settings = settings;
        this.stores = stores;
    }

    public async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        const settings = this.settings();
        if (!settings.enabled) {
            return undefined;
        }
        const costs = await this.service.costsFor(document, token);
        if (!costs || token.isCancellationRequested) {
            return undefined;
        }
        const offset = document.offsetAt(position);
        let entry: ImportCostEntry | undefined;
        for (const candidate of costs.entries) {
            const { start, end } = candidate.source.range;
            if (offset >= start && offset <= end && (!entry || end - start < entry.source.range.end - entry.source.range.start)) {
                entry = candidate;
            }
        }
        if (!entry) {
            return undefined;
        }
        const source = entry.source;
        const index = costs.analysis.imports.indexOf(source);
        const others = await Promise.all(costs.otherTargets.map(async target => ({
            target,
            cost: (await this.service.costsIn(target, document.uri, costs.analysis, token))[index],
        })));
        if (token.isCancellationRequested) {
            return undefined;
        }
        const measurement = await this.measurementOf(document, costs, entry);
        const markdown = hoverMarkdown({ entry, costs, others, display: settings.display, now: Date.now(), measurement });
        return new vscode.Hover(markdown, new vscode.Range(document.positionAt(source.range.start), document.positionAt(source.range.end)));
    }

    private async measurementOf(document: vscode.TextDocument, costs: DocumentCosts, entry: ImportCostEntry): Promise<MeasurementHover> {
        const { target } = costs;
        const importer = documentPathIn(target.baseUri, document.uri);
        const measurement = importer === undefined ? undefined : await this.stores.measurements.find(target.key, importer, entry.source.specifier);
        const kept = entry.cost.status === 'bundled' || entry.cost.status === 'tree-shaken';
        const trusted = vscode.workspace.isTrusted;
        const standaloneArguments = kept ? standaloneArgumentsFor(target, entry.source) : undefined;
        const key = standaloneArguments === undefined ? undefined : standaloneKey(target, standaloneArguments.specifier, standaloneArguments.names);
        const standalone = key === undefined ? undefined : await this.stores.standaloneSizes.find(key);
        const measure = trusted && kept && isMeasurable(target) && document.uri.scheme === 'file' && entry.source.kind !== 'export-all'
            ? measureArgumentsFor(target, document.uri, entry.source)
            : undefined;
        const measureStandalone = trusted ? standaloneArguments : undefined;
        return {
            ...(measurement === undefined ? {} : { measurement }),
            ...(measure === undefined ? {} : { measure }),
            ...(standalone === undefined ? {} : { standalone }),
            ...(measureStandalone === undefined ? {} : { measureStandalone }),
        };
    }
}
