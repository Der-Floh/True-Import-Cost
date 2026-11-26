import * as vscode from 'vscode';

import { moduleUri } from './packagesTree';
import { displayModulePath } from '../presentation/modulePaths';

import type { InclusionChain, InclusionReport, InclusionStep } from '../../core/graph/whyIncluded';
import type { ImportKind } from '../../core/schema/snapshot';
import type { LoadedTarget } from '../services/metadataLoader';

export interface WhyIncludedGroup {
    readonly label: string;
    readonly description?: string;
    readonly report: InclusionReport;
}

export interface WhyIncludedResult {
    readonly target: LoadedTarget;
    readonly subject: string;
    readonly groups: readonly WhyIncludedGroup[];
}

export type WhyIncludedNode =
    | { readonly kind: 'group'; readonly target: LoadedTarget; readonly group: WhyIncludedGroup }
    | { readonly kind: 'chain'; readonly target: LoadedTarget; readonly chain: InclusionChain }
    | { readonly kind: 'step'; readonly target: LoadedTarget; readonly step: InclusionStep; readonly first: boolean }
    | { readonly kind: 'message'; readonly text: string };

const VIA_TEXT: Readonly<Record<ImportKind, string>> = {
    static: 'import',
    dynamic: 'dynamic import',
    require: 'require',
    css: 'CSS import',
    reference: 'reference',
};

function moduleLabel(target: LoadedTarget, moduleId: string): string {
    const module = target.graph.module(moduleId);
    return module === undefined ? moduleId : displayModulePath(module);
}

function chainNodes(target: LoadedTarget, report: InclusionReport): WhyIncludedNode[] {
    if (report.chains.length === 0) {
        return [{
            kind: 'message',
            text: report.directImporters > 0
                ? 'Imported only by modules no entry point reaches'
                : 'No entry point of this build reaches it',
        }];
    }
    return report.chains.map(chain => ({ kind: 'chain', target, chain }));
}

export class WhyIncludedTreeProvider implements vscode.TreeDataProvider<WhyIncludedNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<WhyIncludedNode | undefined>();
    private result: WhyIncludedResult | undefined;

    public readonly onDidChangeTreeData: vscode.Event<WhyIncludedNode | undefined> = this.changed.event;

    public get current(): WhyIncludedResult | undefined {
        return this.result;
    }

    public show(result: WhyIncludedResult | undefined): void {
        this.result = result;
        this.changed.fire(undefined);
    }

    public getChildren(node?: WhyIncludedNode): WhyIncludedNode[] {
        const result = this.result;
        if (!result) {
            return [];
        }
        if (!node) {
            const only = result.groups.length === 1 ? result.groups[0] : undefined;
            if (only) {
                return chainNodes(result.target, only.report);
            }
            return result.groups.map(group => ({ kind: 'group', target: result.target, group }));
        }
        if (node.kind === 'group') {
            return chainNodes(node.target, node.group.report);
        }
        if (node.kind === 'chain') {
            return node.chain.steps.map((step, index) => ({ kind: 'step', target: node.target, step, first: index === 0 }));
        }
        return [];
    }

    public getTreeItem(node: WhyIncludedNode): vscode.TreeItem {
        switch (node.kind) {
            case 'message': {
                const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon('info');
                return item;
            }
            case 'group': {
                const item = new vscode.TreeItem(node.group.label, vscode.TreeItemCollapsibleState.Expanded);
                item.description = node.group.description;
                item.iconPath = new vscode.ThemeIcon('package');
                return item;
            }
            case 'chain': {
                const steps = node.chain.steps;
                const importer = steps.length > 1 ? steps[steps.length - 2] : undefined;
                const entry = steps[0];
                const label = importer === undefined ? 'It is an entry point' : `via ${moduleLabel(node.target, importer.moduleId)}`;
                const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
                item.description = entry === undefined || steps.length <= 1
                    ? undefined
                    : `${steps.length - 1} ${steps.length === 2 ? 'step' : 'steps'} from ${moduleLabel(node.target, entry.moduleId)}`;
                item.tooltip = steps.map(step => moduleLabel(node.target, step.moduleId)).join('\n→ ');
                item.iconPath = new vscode.ThemeIcon('git-merge');
                return item;
            }
            case 'step': {
                const item = new vscode.TreeItem(moduleLabel(node.target, node.step.moduleId), vscode.TreeItemCollapsibleState.None);
                item.description = node.first ? 'entry point' : node.step.via === undefined ? undefined : VIA_TEXT[node.step.via];
                item.iconPath = new vscode.ThemeIcon(node.first ? 'debug-start' : node.target.graph.module(node.step.moduleId)?.packageName === undefined ? 'file-code' : 'package');
                const uri = moduleUri(node.target, node.step.moduleId);
                if (uri) {
                    item.command = { title: 'Open', command: 'vscode.open', arguments: [uri] };
                }
                return item;
            }
        }
    }

    public dispose(): void {
        this.changed.dispose();
    }
}
