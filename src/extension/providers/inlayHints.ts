import * as vscode from 'vscode';

import { Command } from '../constants';
import { explainArgumentsFor } from '../presentation/hoverContent';
import { inlineLabel } from '../presentation/labels';

import type { ImportCostService } from '../services/importCosts';
import type { Settings } from '../services/settings';

export class ImportCostInlayHints implements vscode.InlayHintsProvider, vscode.Disposable {
    private readonly service: ImportCostService;
    private readonly settings: () => Settings;
    private readonly changed = new vscode.EventEmitter<void>();

    public readonly onDidChangeInlayHints: vscode.Event<void> = this.changed.event;

    public constructor(service: ImportCostService, settings: () => Settings) {
        this.service = service;
        this.settings = settings;
    }

    public refresh(): void {
        this.changed.fire();
    }

    public async provideInlayHints(document: vscode.TextDocument, range: vscode.Range, token: vscode.CancellationToken): Promise<vscode.InlayHint[]> {
        const settings = this.settings();
        if (!settings.enabled || !settings.inlayHints) {
            return [];
        }
        const costs = await this.service.costsFor(document, token);
        if (!costs || token.isCancellationRequested) {
            return [];
        }

        const hints: vscode.InlayHint[] = [];
        for (const entry of costs.entries) {
            const position = document.positionAt(entry.source.range.end);
            if (!range.contains(position)) {
                continue;
            }
            const label = inlineLabel(entry.cost, entry.source, { display: settings.display, stale: costs.stale });
            if (label === undefined) {
                continue;
            }
            const part = new vscode.InlayHintLabelPart(label);
            const args = explainArgumentsFor(costs.target, entry.cost);
            if (args) {
                part.command = { title: 'Explain Why Included', command: Command.explainWhyIncluded, arguments: [args] };
                part.tooltip = `Build target "${costs.target.id}". Click to see why it is included.`;
            } else {
                part.tooltip = `Build target "${costs.target.id}".`;
            }
            const hint = new vscode.InlayHint(position, [part]);
            hint.paddingLeft = true;
            hints.push(hint);
        }
        return hints;
    }

    public dispose(): void {
        this.changed.dispose();
    }
}
