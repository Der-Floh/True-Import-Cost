import * as vscode from 'vscode';

import { Command, DISPLAY_NAME, SUPPORTED_LANGUAGES } from '../constants';
import { code, escapeMarkdown } from '../presentation/markdown';
import { budgetFor, evaluateBudgets } from '../../core/budgets';
import { sizeTotals } from '../../core/chunks';
import { formatAge, formatBytes } from '../../core/format';

import type { CurrentTarget } from './currentTarget';
import type { BaselineStore } from '../services/baselineStore';
import type { Settings } from '../services/settings';
import type { SnapshotStore } from '../services/snapshotStore';

const SUPPORTED: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES);

export class TargetStatusBar implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem('trueImportCost.target', vscode.StatusBarAlignment.Right, 100);
    private readonly store: SnapshotStore;
    private readonly current: CurrentTarget;
    private readonly settings: () => Settings;
    private readonly baselines: BaselineStore;

    public constructor(store: SnapshotStore, current: CurrentTarget, settings: () => Settings, baselines: BaselineStore) {
        this.store = store;
        this.current = current;
        this.settings = settings;
        this.baselines = baselines;
        this.item.name = DISPLAY_NAME;
    }

    public update(): void {
        const editor = vscode.window.activeTextEditor;
        const supported = editor !== undefined && SUPPORTED.has(editor.document.languageId);
        if (!this.settings().enabled) {
            this.item.hide();
            return;
        }

        const resolved = this.current.resolve();
        if (!resolved) {
            const failures = this.store.failures();
            if (!supported && failures.length === 0) {
                this.item.hide();
                return;
            }
            this.item.text = failures.length > 0 ? '$(warning) No usable build metadata' : '$(package) No build metadata';
            this.item.tooltip = failures.length > 0
                ? new vscode.MarkdownString(failures.map(failure => `${code(vscode.workspace.asRelativePath(failure.source.uri))}: ${escapeMarkdown(failure.error)}`).join('\n\n'))
                : 'True Import Cost has not found any build metadata. Click to import a metafile or snapshot.';
            this.item.command = Command.importMetadata;
            this.item.show();
            return;
        }

        const { target, containsActiveDocument } = resolved;
        const totals = sizeTotals(target.snapshot);
        const failure = this.store.failureFor(target.key);
        const baseline = this.baselines.peek(target.key);
        const budget = budgetFor(this.settings().budgets, target.id);
        const overBudget = budget === undefined ? [] : evaluateBudgets(budget, totals, target.graph).filter(result => result.exceeded && result.kind !== 'package');
        const delta = baseline === undefined ? undefined : totals.total - sizeTotals(baseline.graph.snapshot).total;
        const deltaText = delta === undefined || delta === 0 ? '' : ` (${delta > 0 ? '+' : '−'}${formatBytes(Math.abs(delta))})`;
        this.item.text = `${failure || overBudget.length > 0 ? '$(warning)' : '$(package)'} ${target.id} · ${formatBytes(totals.total)}${deltaText}`;
        const snapshot = target.snapshot;
        const bundler = [snapshot.bundler.name, snapshot.bundler.version].filter(Boolean).join(' ');
        const lines = [
            `**${escapeMarkdown(DISPLAY_NAME)}** · ${code(target.id)}`,
            '',
            `${escapeMarkdown(bundler)}${snapshot.bundler.engine === undefined ? '' : ` (${escapeMarkdown(snapshot.bundler.engine)})`}${snapshot.mode === undefined ? '' : ` · ${snapshot.mode}`}`,
            '',
            `JavaScript ${escapeMarkdown(formatBytes(totals.javascript))} · CSS ${escapeMarkdown(formatBytes(totals.css))} · other assets ${escapeMarkdown(formatBytes(totals.assets))}`,
            '',
            `${target.graph.moduleCount} modules · ${target.graph.packages().size} packages · built ${escapeMarkdown(formatAge(Date.now() - snapshot.createdAt))}`,
            '',
            code(vscode.workspace.asRelativePath(target.source.uri)),
        ];
        if (baseline !== undefined) {
            const change = delta === undefined || delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${formatBytes(Math.abs(delta))}`;
            lines.push('', `Compared with ${escapeMarkdown(baseline.label.toLowerCase())} from ${escapeMarkdown(formatAge(Date.now() - baseline.graph.snapshot.createdAt))}: ${escapeMarkdown(change)}`);
        }
        for (const result of overBudget) {
            lines.push('', `$(warning) ${escapeMarkdown(result.label)} is ${escapeMarkdown(formatBytes(result.actual))}, over its budget of ${escapeMarkdown(formatBytes(result.limit))}`);
        }
        if (failure) {
            lines.push('', `$(warning) The last update could not be read, so this is the previous build: ${escapeMarkdown(failure.error)}`);
        }
        if (supported && !containsActiveDocument) {
            lines.push('', 'The active file is not part of this build target.');
        }
        lines.push('', 'Click to select another build target.');
        const tooltip = new vscode.MarkdownString(lines.join('\n'), true);
        this.item.tooltip = tooltip;
        this.item.command = Command.selectTarget;
        this.item.show();
    }

    public dispose(): void {
        this.item.dispose();
    }
}
