import * as vscode from 'vscode';

import { Command, DISPLAY_NAME, SUPPORTED_LANGUAGES } from '../constants';
import { code, escapeMarkdown } from '../presentation/markdown';
import { formatAge, formatBytes } from '../../core/format';

import type { CurrentTarget } from './currentTarget';
import type { SnapshotStore } from '../services/snapshotStore';

const SUPPORTED: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES);

export class TargetStatusBar implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem('trueImportCost.target', vscode.StatusBarAlignment.Right, 100);
    private readonly store: SnapshotStore;
    private readonly current: CurrentTarget;
    private readonly isEnabled: () => boolean;

    public constructor(store: SnapshotStore, current: CurrentTarget, isEnabled: () => boolean) {
        this.store = store;
        this.current = current;
        this.isEnabled = isEnabled;
        this.item.name = DISPLAY_NAME;
    }

    public update(): void {
        const editor = vscode.window.activeTextEditor;
        const supported = editor !== undefined && SUPPORTED.has(editor.document.languageId);
        if (!this.isEnabled()) {
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
        const totals = target.graph.totals();
        const failure = this.store.failureFor(target.key);
        this.item.text = `${failure ? '$(warning)' : '$(package)'} ${target.id} · ${formatBytes(totals.total)}`;
        const snapshot = target.snapshot;
        const bundler = [snapshot.bundler.name, snapshot.bundler.version].filter(Boolean).join(' ');
        const lines = [
            `**${escapeMarkdown(DISPLAY_NAME)}** · ${code(target.id)}`,
            '',
            `${escapeMarkdown(bundler)}${snapshot.bundler.engine === undefined ? '' : ` (${escapeMarkdown(snapshot.bundler.engine)})`}${snapshot.mode === undefined ? '' : ` · ${snapshot.mode}`}`,
            '',
            `JavaScript ${escapeMarkdown(formatBytes(totals.js))} · CSS ${escapeMarkdown(formatBytes(totals.css))} · other assets ${escapeMarkdown(formatBytes(totals.assets))}`,
            '',
            `${target.graph.moduleCount} modules · ${target.graph.packages().size} packages · built ${escapeMarkdown(formatAge(Date.now() - snapshot.createdAt))}`,
            '',
            code(vscode.workspace.asRelativePath(target.source.uri)),
        ];
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
