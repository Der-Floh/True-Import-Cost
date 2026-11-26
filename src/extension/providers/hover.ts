import * as vscode from 'vscode';

import { hoverMarkdown } from '../presentation/hoverContent';

import type { ImportCostEntry, ImportCostService } from '../services/importCosts';
import type { Settings } from '../services/settings';

export class ImportCostHover implements vscode.HoverProvider {
    private readonly service: ImportCostService;
    private readonly settings: () => Settings;

    public constructor(service: ImportCostService, settings: () => Settings) {
        this.service = service;
        this.settings = settings;
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
        const others = costs.otherTargets.map(target => ({ target, cost: this.service.costIn(target, document.uri, source) }));
        const markdown = hoverMarkdown({ entry, costs, others, display: settings.display, now: Date.now() });
        return new vscode.Hover(markdown, new vscode.Range(document.positionAt(source.range.start), document.positionAt(source.range.end)));
    }
}
