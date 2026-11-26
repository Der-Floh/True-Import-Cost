import * as vscode from 'vscode';

import { sizeText } from '../presentation/labels';
import { displayModulePath } from '../presentation/modulePaths';
import { formatBytes } from '../../core/format';
import { duplicatePackages } from '../../core/graph/duplicates';
import { relativePath } from '../../core/paths';

import type { CurrentTarget } from './currentTarget';
import type { PackageInstance } from '../../core/graph/buildGraph';
import type { ExplainArguments } from '../presentation/hoverContent';
import type { LoadedTarget } from '../services/metadataLoader';

export type PackagesNode =
    | { readonly kind: 'group'; readonly label: string; readonly icon: string; readonly target: LoadedTarget; readonly moduleIds: readonly string[]; readonly bytes: number }
    | { readonly kind: 'package'; readonly target: LoadedTarget; readonly instance: PackageInstance; readonly duplicate: boolean; readonly explain: ExplainArguments }
    | { readonly kind: 'module'; readonly target: LoadedTarget; readonly moduleId: string; readonly label: string; readonly explain: ExplainArguments };

const MAX_CHILDREN = 500;

function sortedModules(target: LoadedTarget, ids: Iterable<string>): string[] {
    return [...ids].filter(id => target.graph.bytesOf(id) > 0).sort((a, b) => target.graph.bytesOf(b) - target.graph.bytesOf(a));
}

export function moduleUri(target: LoadedTarget, moduleId: string): vscode.Uri | undefined {
    const module = target.graph.module(moduleId);
    return module === undefined || module.virtual === true ? undefined : vscode.Uri.joinPath(target.baseUri, module.path);
}

export class PackagesTreeProvider implements vscode.TreeDataProvider<PackagesNode>, vscode.Disposable {
    private readonly current: CurrentTarget;
    private readonly changed = new vscode.EventEmitter<PackagesNode | undefined>();

    public readonly onDidChangeTreeData: vscode.Event<PackagesNode | undefined> = this.changed.event;

    public constructor(current: CurrentTarget) {
        this.current = current;
    }

    public refresh(): void {
        this.changed.fire(undefined);
    }

    public getChildren(node?: PackagesNode): PackagesNode[] {
        if (!node) {
            const resolved = this.current.resolve();
            return resolved ? this.rootNodes(resolved.target) : [];
        }
        if (node.kind === 'package') {
            return sortedModules(node.target, node.instance.moduleIds).slice(0, MAX_CHILDREN).map(id => ({
                kind: 'module',
                target: node.target,
                moduleId: id,
                label: relativePath(node.instance.root, node.target.graph.module(id)?.path ?? id),
                explain: { target: node.target.key, modules: [id], label: node.target.graph.module(id)?.path ?? id },
            }));
        }
        if (node.kind === 'group') {
            return node.moduleIds.slice(0, MAX_CHILDREN).map((id) => {
                const module = node.target.graph.module(id);
                return {
                    kind: 'module',
                    target: node.target,
                    moduleId: id,
                    label: module === undefined ? id : displayModulePath(module),
                    explain: { target: node.target.key, modules: [id], label: module?.path ?? id },
                };
            });
        }
        return [];
    }

    public getTreeItem(node: PackagesNode): vscode.TreeItem {
        switch (node.kind) {
            case 'group': {
                const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
                item.description = formatBytes(node.bytes);
                item.iconPath = new vscode.ThemeIcon(node.icon);
                item.contextValue = 'group';
                return item;
            }
            case 'package': {
                const { instance } = node;
                const item = new vscode.TreeItem(instance.name, vscode.TreeItemCollapsibleState.Collapsed);
                item.description = [instance.version, formatBytes(instance.bytes), node.duplicate ? 'duplicated' : undefined].filter(Boolean).join(' · ');
                item.iconPath = new vscode.ThemeIcon(node.duplicate ? 'warning' : 'package');
                item.tooltip = `${instance.name}${instance.version === undefined ? '' : `@${instance.version}`}\n${instance.root}\n${instance.moduleIds.length} modules`;
                item.contextValue = 'package';
                return item;
            }
            case 'module': {
                const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
                const graph = node.target.graph;
                item.description = sizeText(graph.bytesOf(node.moduleId), graph.precisionOf(node.moduleId));
                item.iconPath = new vscode.ThemeIcon('file-code');
                item.contextValue = 'module';
                item.tooltip = graph.module(node.moduleId)?.path ?? node.moduleId;
                const uri = moduleUri(node.target, node.moduleId);
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

    private rootNodes(target: LoadedTarget): PackagesNode[] {
        const graph = target.graph;
        const duplicated = new Set(duplicatePackages(graph).map(duplicate => duplicate.name));
        const nodes: PackagesNode[] = [];
        for (const instance of graph.packages().values()) {
            if (instance.bytes > 0) {
                nodes.push({
                    kind: 'package',
                    target,
                    instance,
                    duplicate: duplicated.has(instance.name),
                    explain: { target: target.key, packageRoot: instance.root, label: instance.name },
                });
            }
        }
        const project: string[] = [];
        const generated: string[] = [];
        for (const module of graph.modules()) {
            if (module.packageName === undefined && graph.bytesOf(module.id) > 0) {
                (module.virtual === true ? generated : project).push(module.id);
            }
        }
        const bytesOf = (ids: readonly string[]): number => ids.reduce((sum, id) => sum + graph.bytesOf(id), 0);
        if (project.length > 0) {
            nodes.push({ kind: 'group', label: 'Project sources', icon: 'folder', target, moduleIds: sortedModules(target, project), bytes: bytesOf(project) });
        }
        if (generated.length > 0) {
            nodes.push({ kind: 'group', label: 'Generated by the bundler', icon: 'gear', target, moduleIds: sortedModules(target, generated), bytes: bytesOf(generated) });
        }
        const weight = (node: PackagesNode): number => (node.kind === 'package' ? node.instance.bytes : node.kind === 'group' ? node.bytes : 0);
        return nodes.sort((a, b) => weight(b) - weight(a));
    }
}
