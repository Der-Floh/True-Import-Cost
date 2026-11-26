import * as vscode from 'vscode';

import { Command, DISPLAY_NAME, SUPPORTED_LANGUAGES } from '../constants';
import { formatBytes } from '../../core/format';

import type { DuplicatePackage } from '../../core/graph/duplicates';
import type { ExplainArguments } from '../presentation/hoverContent';
import type { ImportCostService } from '../services/importCosts';
import type { Settings } from '../services/settings';

export const DUPLICATE_PACKAGE_CODE = 'duplicate-package';

const SUPPORTED: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES);

export function duplicateMessage(duplicate: DuplicatePackage, target: string): string {
    const versions = duplicate.instances
        .map(instance => `${instance.version ?? 'unknown version'} (${formatBytes(instance.bytes)})`)
        .join(', ');
    return `${duplicate.name} is bundled ${duplicate.instances.length} times in "${target}": ${versions}. Together ${formatBytes(duplicate.bytes)}.`;
}

export class DuplicatePackageDiagnostics implements vscode.Disposable {
    private readonly service: ImportCostService;
    private readonly settings: () => Settings;
    private readonly collection = vscode.languages.createDiagnosticCollection('trueImportCost');
    private readonly pending = new Map<string, vscode.CancellationTokenSource>();
    private readonly subscriptions: vscode.Disposable[];

    public constructor(service: ImportCostService, settings: () => Settings) {
        this.service = service;
        this.settings = settings;
        this.subscriptions = [
            this.collection,
            vscode.workspace.onDidOpenTextDocument(document => void this.update(document)),
            vscode.workspace.onDidChangeTextDocument(event => void this.update(event.document)),
            vscode.workspace.onDidCloseTextDocument((document) => {
                this.pending.get(document.uri.toString())?.cancel();
                this.collection.delete(document.uri);
            }),
        ];
    }

    public refreshAll(): void {
        for (const document of vscode.workspace.textDocuments) {
            void this.update(document);
        }
    }

    public async update(document: vscode.TextDocument): Promise<void> {
        const key = document.uri.toString();
        this.pending.get(key)?.cancel();
        const cancellation = new vscode.CancellationTokenSource();
        this.pending.set(key, cancellation);
        try {
            const settings = this.settings();
            if (!SUPPORTED.has(document.languageId) || !settings.enabled || !settings.duplicateDiagnostics) {
                this.collection.delete(document.uri);
                return;
            }
            const costs = await this.service.costsFor(document, cancellation.token);
            if (cancellation.token.isCancellationRequested) {
                return;
            }
            if (!costs) {
                this.collection.delete(document.uri);
                return;
            }
            const diagnostics: vscode.Diagnostic[] = [];
            for (const entry of costs.entries) {
                const cost = entry.cost;
                if ((cost.status !== 'bundled' && cost.status !== 'tree-shaken') || !cost.duplicate) {
                    continue;
                }
                const range = new vscode.Range(
                    document.positionAt(entry.source.specifierRange.start),
                    document.positionAt(entry.source.specifierRange.end),
                );
                const diagnostic = new vscode.Diagnostic(range, duplicateMessage(cost.duplicate, costs.target.id), vscode.DiagnosticSeverity.Information);
                diagnostic.source = DISPLAY_NAME;
                diagnostic.code = DUPLICATE_PACKAGE_CODE;
                diagnostics.push(diagnostic);
            }
            this.collection.set(document.uri, diagnostics);
        } finally {
            if (this.pending.get(key) === cancellation) {
                this.pending.delete(key);
            }
            cancellation.dispose();
        }
    }

    public clear(): void {
        this.collection.clear();
    }

    public dispose(): void {
        for (const cancellation of this.pending.values()) {
            cancellation.cancel();
        }
        this.pending.clear();
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
    }
}

export class DuplicatePackageQuickFix implements vscode.CodeActionProvider {
    public static readonly kinds = [vscode.CodeActionKind.QuickFix];

    private readonly service: ImportCostService;

    public constructor(service: ImportCostService) {
        this.service = service;
    }

    public async provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.CodeAction[]> {
        const duplicates = context.diagnostics.filter(diagnostic => diagnostic.code === DUPLICATE_PACKAGE_CODE);
        if (duplicates.length === 0) {
            return [];
        }
        const costs = await this.service.costsFor(document, token);
        if (!costs) {
            return [];
        }
        const actions: vscode.CodeAction[] = [];
        for (const diagnostic of duplicates) {
            const start = document.offsetAt(diagnostic.range.start);
            const entry = costs.entries.find(candidate => candidate.source.specifierRange.start === start);
            const cost = entry?.cost;
            if (!entry || (cost?.status !== 'bundled' && cost?.status !== 'tree-shaken') || !cost.duplicate) {
                continue;
            }
            const args: ExplainArguments = { target: costs.target.key, packageName: cost.duplicate.name, label: cost.duplicate.name };
            const action = new vscode.CodeAction(`Explain why ${cost.duplicate.name} is bundled ${cost.duplicate.instances.length} times`, vscode.CodeActionKind.QuickFix);
            action.command = { title: action.title, command: Command.explainWhyIncluded, arguments: [args] };
            action.diagnostics = [diagnostic];
            actions.push(action);
        }
        return actions;
    }
}
