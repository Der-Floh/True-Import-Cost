import * as vscode from 'vscode';

import { Command, DISPLAY_NAME, SUPPORTED_LANGUAGES } from '../constants';
import { budgetFor, packageLimit } from '../../core/budgets';
import { formatBytes } from '../../core/format';

import type { Budget } from '../../core/budgets';
import type { DuplicatePackage } from '../../core/graph/duplicates';
import type { LoadedTarget } from '../services/metadataLoader';
import type { ExplainArguments } from '../presentation/hoverContent';
import type { ImportCostEntry, ImportCostService } from '../services/importCosts';
import type { Settings } from '../services/settings';

export const DUPLICATE_PACKAGE_CODE = 'duplicate-package';

export const IMPORT_BUDGET_CODE = 'import-budget';

export const PACKAGE_BUDGET_CODE = 'package-budget';

const SUPPORTED: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES);

export function duplicateMessage(duplicate: DuplicatePackage, target: string): string {
    const versions = duplicate.instances
        .map(instance => `${instance.version ?? 'unknown version'} (${formatBytes(instance.bytes)})`)
        .join(', ');
    return `${duplicate.name} is bundled ${duplicate.instances.length} times in "${target}": ${versions}. Together ${formatBytes(duplicate.bytes)}.`;
}

function packageBytes(target: LoadedTarget, name: string): number {
    let bytes = 0;
    for (const instance of target.graph.packages().values()) {
        if (instance.name === name) {
            bytes += instance.bytes;
        }
    }
    return bytes;
}

interface Finding {
    readonly message: string;
    readonly severity: vscode.DiagnosticSeverity;
    readonly code: string;
}

function findingsFor(entry: ImportCostEntry, target: LoadedTarget, settings: Settings, budget: Budget | undefined): Finding[] {
    const cost = entry.cost;
    if (cost.status !== 'bundled' && cost.status !== 'tree-shaken') {
        return [];
    }
    const findings: Finding[] = [];
    if (settings.duplicateDiagnostics && cost.duplicate) {
        findings.push({ message: duplicateMessage(cost.duplicate, target.id), severity: vscode.DiagnosticSeverity.Information, code: DUPLICATE_PACKAGE_CODE });
    }
    if (budget?.import !== undefined && cost.impact.bundledBytes > budget.import) {
        findings.push({
            message: `${entry.source.specifier} pulls ${formatBytes(cost.impact.bundledBytes)} into "${target.id}", over the import budget of ${formatBytes(budget.import)}.`,
            severity: vscode.DiagnosticSeverity.Warning,
            code: IMPORT_BUDGET_CODE,
        });
    }
    const limit = budget === undefined || cost.package === undefined ? undefined : packageLimit(budget, cost.package.name);
    if (limit !== undefined && cost.package !== undefined) {
        const bytes = packageBytes(target, cost.package.name);
        if (bytes > limit) {
            findings.push({
                message: `${cost.package.name} is ${formatBytes(bytes)} in "${target.id}", over its budget of ${formatBytes(limit)}.`,
                severity: vscode.DiagnosticSeverity.Warning,
                code: PACKAGE_BUDGET_CODE,
            });
        }
    }
    return findings;
}

export class BundleDiagnostics implements vscode.Disposable {
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
            if (!SUPPORTED.has(document.languageId) || !settings.enabled) {
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
            const budget = budgetFor(settings.budgets, costs.target.id);
            const diagnostics: vscode.Diagnostic[] = [];
            for (const entry of costs.entries) {
                const findings = findingsFor(entry, costs.target, settings, budget);
                if (findings.length === 0) {
                    continue;
                }
                const range = new vscode.Range(
                    document.positionAt(entry.source.specifierRange.start),
                    document.positionAt(entry.source.specifierRange.end),
                );
                for (const finding of findings) {
                    const diagnostic = new vscode.Diagnostic(range, finding.message, finding.severity);
                    diagnostic.source = DISPLAY_NAME;
                    diagnostic.code = finding.code;
                    diagnostics.push(diagnostic);
                }
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
