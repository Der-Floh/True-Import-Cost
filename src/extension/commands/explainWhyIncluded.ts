import * as vscode from 'vscode';

import { View } from '../constants';
import { explainArgumentsFor } from '../presentation/hoverContent';
import { displayModulePath } from '../presentation/modulePaths';
import { formatBytes } from '../../core/format';
import { explainInclusion } from '../../core/graph/whyIncluded';

import type { ExplainArguments } from '../presentation/hoverContent';
import type { ImportCostService } from '../services/importCosts';
import type { LoadedTarget } from '../services/metadataLoader';
import type { SnapshotStore } from '../services/snapshotStore';
import type { CurrentTarget } from '../views/currentTarget';
import type { WhyIncludedGroup, WhyIncludedResult, WhyIncludedTreeProvider } from '../views/whyIncludedTree';

export interface ExplainDependencies {
    readonly store: SnapshotStore;
    readonly service: ImportCostService;
    readonly current: CurrentTarget;
    readonly whyIncluded: WhyIncludedTreeProvider;
}

const MAX_PICKED_MODULES = 300;

export function isExplainArguments(value: unknown): value is ExplainArguments {
    return typeof value === 'object' && value !== null && typeof (value as { target?: unknown }).target === 'string';
}

function argumentsOf(value: unknown): ExplainArguments | undefined {
    if (isExplainArguments(value)) {
        return value;
    }
    const nested = typeof value === 'object' && value !== null ? (value as { explain?: unknown }).explain : undefined;
    return isExplainArguments(nested) ? nested : undefined;
}

async function fromActiveEditor(dependencies: ExplainDependencies): Promise<ExplainArguments | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return undefined;
    }
    const cancellation = new vscode.CancellationTokenSource();
    try {
        const costs = await dependencies.service.costsFor(editor.document, cancellation.token);
        const offset = editor.document.offsetAt(editor.selection.active);
        const entry = costs?.entries.find(candidate => offset >= candidate.source.range.start && offset <= candidate.source.range.end);
        return costs && entry ? explainArgumentsFor(costs.target, entry.cost) : undefined;
    } finally {
        cancellation.dispose();
    }
}

async function pickSubject(dependencies: ExplainDependencies): Promise<ExplainArguments | undefined> {
    const target = dependencies.current.resolve()?.target;
    if (!target) {
        void vscode.window.showInformationMessage('True Import Cost has no build metadata to explain yet.');
        return undefined;
    }
    const graph = target.graph;
    type Item = vscode.QuickPickItem & { readonly explain?: ExplainArguments };
    const packages: Item[] = [...graph.packages().values()]
        .filter(instance => instance.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes)
        .map(instance => ({
            label: `$(package) ${instance.name}`,
            description: [instance.version, formatBytes(instance.bytes)].filter(Boolean).join(' · '),
            explain: { target: target.key, packageRoot: instance.root, label: instance.name },
        }));
    const modules: Item[] = [...graph.modules()]
        .filter(module => graph.bytesOf(module.id) > 0)
        .sort((a, b) => graph.bytesOf(b.id) - graph.bytesOf(a.id))
        .slice(0, MAX_PICKED_MODULES)
        .map(module => ({
            label: `$(file-code) ${displayModulePath(module)}`,
            description: formatBytes(graph.bytesOf(module.id)),
            explain: { target: target.key, modules: [module.id], label: module.path },
        }));
    const picked = await vscode.window.showQuickPick<Item>([
        { label: 'Packages', kind: vscode.QuickPickItemKind.Separator },
        ...packages,
        { label: 'Modules', kind: vscode.QuickPickItemKind.Separator },
        ...modules,
    ], { placeHolder: `Why is it in "${target.id}"? Pick a package or a module`, matchOnDescription: true });
    return picked?.explain;
}

function groupsFor(target: LoadedTarget, args: ExplainArguments): WhyIncludedGroup[] {
    const graph = target.graph;
    if (args.packageName !== undefined) {
        const instances = [...graph.packages().values()].filter(instance => instance.name === args.packageName);
        const retained = instances.filter(instance => instance.bytes > 0);
        return (retained.length > 0 ? retained : instances).map(instance => ({
            label: `${instance.name}${instance.version === undefined ? '' : ` ${instance.version}`}`,
            description: `${formatBytes(instance.bytes)} · ${instance.root}`,
            report: explainInclusion(graph, instance.moduleIds),
        }));
    }
    if (args.packageRoot !== undefined) {
        const instance = graph.packages().get(args.packageRoot);
        return instance === undefined ? [] : [{
            label: instance.name,
            description: formatBytes(instance.bytes),
            report: explainInclusion(graph, instance.moduleIds),
        }];
    }
    const modules = (args.modules ?? []).filter(id => graph.module(id) !== undefined);
    return modules.length === 0 ? [] : [{
        label: args.label ?? modules.join(', '),
        report: explainInclusion(graph, modules),
    }];
}

export async function explainWhyIncluded(dependencies: ExplainDependencies, argument?: unknown): Promise<void> {
    const args = argumentsOf(argument) ?? await fromActiveEditor(dependencies) ?? await pickSubject(dependencies);
    if (!args) {
        return;
    }
    const target = dependencies.store.target(args.target);
    if (!target) {
        void vscode.window.showWarningMessage('That build target is no longer loaded. Refresh and try again.');
        return;
    }
    const groups = groupsFor(target, args);
    if (groups.length === 0) {
        void vscode.window.showWarningMessage(`"${args.label ?? 'It'}" is not part of build target "${target.id}".`);
        return;
    }
    const result: WhyIncludedResult = { target, subject: args.label ?? groups[0]?.label ?? '', groups };
    dependencies.whyIncluded.show(result);
    await vscode.commands.executeCommand(`${View.whyIncluded}.focus`);
}
