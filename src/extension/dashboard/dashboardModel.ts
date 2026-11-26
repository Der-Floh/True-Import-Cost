import { evaluateBudgets, packageLimit } from '../../core/budgets';
import { chunkLoading, lazyBytesByModule, sizeTotals } from '../../core/chunks';
import { chunkKey, compareBuilds } from '../../core/compare';
import { duplicatePackages } from '../../core/graph/duplicates';
import { relativePath } from '../../core/paths';
import { displayModulePath } from '../presentation/modulePaths';

import type { Budget } from '../../core/budgets';
import type { SizeTotals } from '../../core/chunks';
import type { BuildComparison } from '../../core/compare';
import type { BuildGraph, PackageInstance } from '../../core/graph/buildGraph';
import type { HistoryEntry } from '../../core/history';
import type { BuildSnapshot, ModuleRecord } from '../../core/schema/snapshot';
import type {
    AssetGroupDto,
    AssetKindDto,
    BudgetStateDto,
    ChunkRowDto,
    DashboardModel,
    DuplicateDto,
    ModuleChangeDto,
    PackageRowDto,
    TargetComparisonDto,
    TargetDashboardDto,
    TargetSummaryDto,
    TreemapNodeDto,
} from '../../shared/dashboard';
import type { Baseline } from '../services/baselineStore';
import type { LoadedTarget } from '../services/metadataLoader';

export interface TargetInput {
    readonly target: LoadedTarget;
    readonly failure?: string;
}

export interface SelectedInput {
    readonly target: LoadedTarget;
    readonly metadataPath: string;
    readonly baseline?: Baseline;
    readonly history: readonly HistoryEntry[];
    readonly budget?: Budget;
}

export interface DashboardInputs {
    readonly targets: readonly TargetInput[];
    readonly selected?: SelectedInput;
    readonly historyEnabled: boolean;
}

const MAX_CHILDREN = 150;
const MAX_MODULE_CHANGES = 30;
const MAX_COMPARISON_ROWS = 100;
const ASSET_ORDER: readonly AssetKindDto[] = ['image', 'font', 'wasm', 'html', 'other'];

interface Draft {
    readonly id: string;
    readonly label: string;
    readonly kind: TreemapNodeDto['kind'];
    bytes: number;
    lazyBytes: number;
    readonly children: Map<string, Draft>;
    readonly leaf?: TreemapNodeDto;
}

export function bundlerText(snapshot: BuildSnapshot): string {
    const { name, version, engine } = snapshot.bundler;
    const main = version === undefined ? name : `${name} ${version}`;
    return engine === undefined ? main : `${main} (${engine})`;
}

function moduleLeaf(graph: BuildGraph, module: ModuleRecord, label: string, lazy: ReadonlyMap<string, number>): TreemapNodeDto {
    const bytes = graph.bytesOf(module.id);
    return {
        id: `module:${module.id}`,
        label,
        bytes,
        kind: 'module',
        lazy: (lazy.get(module.id) ?? 0) >= bytes,
        moduleId: module.id,
        openable: module.virtual !== true,
    };
}

function folded(children: TreemapNodeDto[], parentId: string): TreemapNodeDto[] {
    const sorted = [...children].sort((a, b) => b.bytes - a.bytes || a.label.localeCompare(b.label));
    if (sorted.length <= MAX_CHILDREN) {
        return sorted;
    }
    const kept = sorted.slice(0, MAX_CHILDREN - 1);
    const rest = sorted.slice(MAX_CHILDREN - 1);
    return [...kept, {
        id: `other:${parentId}`,
        label: `${rest.length} smaller`,
        bytes: rest.reduce((sum, node) => sum + node.bytes, 0),
        kind: 'other',
        lazy: rest.every(node => node.lazy),
    }];
}

function collapse(draft: Draft): { readonly node: Draft; readonly path: string } {
    let node = draft;
    const names: string[] = [];
    while (node.children.size === 1) {
        const only = [...node.children.values()][0] as Draft;
        if (only.leaf) {
            break;
        }
        names.push(only.label);
        node = only;
    }
    return { node, path: names.join('/') };
}

function finish(draft: Draft): TreemapNodeDto {
    if (draft.leaf) {
        return draft.leaf;
    }
    const { node, path } = collapse(draft);
    return {
        id: node.id,
        label: path === '' ? draft.label : `${draft.label}/${path}`,
        bytes: draft.bytes,
        kind: 'project',
        lazy: draft.lazyBytes >= draft.bytes,
        children: folded([...node.children.values()].map(finish), node.id),
    };
}

function projectNode(graph: BuildGraph, modules: readonly ModuleRecord[], lazy: ReadonlyMap<string, number>): TreemapNodeDto | undefined {
    if (modules.length === 0) {
        return undefined;
    }
    const root: Draft = { id: 'group:project', label: 'Project sources', kind: 'project', bytes: 0, lazyBytes: 0, children: new Map() };
    for (const module of modules) {
        const leaf = moduleLeaf(graph, module, module.path.slice(module.path.lastIndexOf('/') + 1), lazy);
        const moduleLazy = lazy.get(module.id) ?? 0;
        const segments = module.path.split('/');
        let directory = root;
        directory.bytes += leaf.bytes;
        directory.lazyBytes += moduleLazy;
        segments.slice(0, -1).forEach((segment, index) => {
            let next = directory.children.get(`dir:${segment}`);
            if (!next) {
                next = { id: `dir:${segments.slice(0, index + 1).join('/')}`, label: segment, kind: 'project', bytes: 0, lazyBytes: 0, children: new Map() };
                directory.children.set(`dir:${segment}`, next);
            }
            next.bytes += leaf.bytes;
            next.lazyBytes += moduleLazy;
            directory = next;
        });
        directory.children.set(`module:${module.id}`, {
            id: leaf.id, label: leaf.label, kind: 'module', bytes: leaf.bytes, lazyBytes: 0, children: new Map(), leaf,
        });
    }
    const { node, path } = collapse(root);
    return {
        id: root.id,
        label: path === '' ? root.label : `${root.label} (${path}/)`,
        bytes: root.bytes,
        kind: 'project',
        lazy: root.lazyBytes >= root.bytes,
        children: folded([...node.children.values()].map(finish), root.id),
    };
}

function packageNode(graph: BuildGraph, instance: PackageInstance, duplicate: boolean, lazy: ReadonlyMap<string, number>): TreemapNodeDto {
    const modules = instance.moduleIds
        .map(id => graph.module(id))
        .filter((module): module is ModuleRecord => module !== undefined && graph.bytesOf(module.id) > 0);
    const lazyBytes = modules.reduce((sum, module) => sum + (lazy.get(module.id) ?? 0), 0);
    const versioned = duplicate && instance.version !== undefined ? `${instance.name} ${instance.version}` : instance.name;
    return {
        id: `package:${instance.root}`,
        label: versioned,
        bytes: instance.bytes,
        kind: 'package',
        lazy: lazyBytes >= instance.bytes,
        duplicate,
        packageName: instance.name,
        children: folded(modules.map(module => moduleLeaf(graph, module, relativePath(instance.root, module.path), lazy)), `package:${instance.root}`),
    };
}

function generatedNode(graph: BuildGraph, modules: readonly ModuleRecord[], lazy: ReadonlyMap<string, number>): TreemapNodeDto | undefined {
    if (modules.length === 0) {
        return undefined;
    }
    const children = modules.map(module => moduleLeaf(graph, module, displayModulePath(module), lazy));
    const bytes = children.reduce((sum, node) => sum + node.bytes, 0);
    return {
        id: 'group:generated',
        label: 'Generated by the bundler',
        bytes,
        kind: 'generated',
        lazy: children.every(node => node.lazy),
        children: folded(children, 'group:generated'),
    };
}

export function treemapOf(graph: BuildGraph, label: string): TreemapNodeDto {
    const lazy = lazyBytesByModule(graph.snapshot);
    const duplicated = new Set(duplicatePackages(graph).map(duplicate => duplicate.name));
    const project: ModuleRecord[] = [];
    const generated: ModuleRecord[] = [];
    for (const module of graph.modules()) {
        if (module.packageName === undefined && graph.bytesOf(module.id) > 0) {
            (module.virtual === true ? generated : project).push(module);
        }
    }
    const packages = [...graph.packages().values()]
        .filter(instance => instance.bytes > 0)
        .map(instance => packageNode(graph, instance, duplicated.has(instance.name), lazy));
    const children = [projectNode(graph, project, lazy), ...packages, generatedNode(graph, generated, lazy)]
        .filter((node): node is TreemapNodeDto => node !== undefined);
    return {
        id: 'root',
        label,
        bytes: children.reduce((sum, node) => sum + node.bytes, 0),
        kind: 'root',
        lazy: children.length > 0 && children.every(node => node.lazy),
        children: folded(children, 'root'),
    };
}

function packageRows(graph: BuildGraph, comparison: BuildComparison | undefined, budget: Budget | undefined): PackageRowDto[] {
    const lazy = lazyBytesByModule(graph.snapshot);
    const byName = new Map<string, { versions: Set<string>; bytes: number; lazyBytes: number; modules: number; instances: number }>();
    for (const instance of graph.packages().values()) {
        if (instance.bytes <= 0) {
            continue;
        }
        const row = byName.get(instance.name) ?? { versions: new Set<string>(), bytes: 0, lazyBytes: 0, modules: 0, instances: 0 };
        if (instance.version !== undefined) {
            row.versions.add(instance.version);
        }
        row.bytes += instance.bytes;
        row.lazyBytes += instance.moduleIds.reduce((sum, id) => sum + (lazy.get(id) ?? 0), 0);
        row.modules += instance.moduleIds.filter(id => graph.bytesOf(id) > 0).length;
        row.instances++;
        byName.set(instance.name, row);
    }
    const changes = new Map(comparison?.packages.map(change => [change.name, change]) ?? []);
    const rows = [...byName].map(([name, row]): PackageRowDto => {
        const change = changes.get(name);
        const limit = budget === undefined ? undefined : packageLimit(budget, name);
        return {
            name,
            versions: [...row.versions].sort(),
            bytes: row.bytes,
            lazyBytes: row.lazyBytes,
            modules: row.modules,
            duplicate: row.instances > 1,
            ...(change === undefined ? {} : { change: { status: change.status, before: change.before, delta: change.delta, versionsBefore: change.versionsBefore } }),
            ...(limit === undefined ? {} : { budget: { kind: 'package', label: name, limit, actual: row.bytes, exceeded: row.bytes > limit } }),
        };
    });
    for (const change of comparison?.packages ?? []) {
        if (change.status === 'removed') {
            rows.push({
                name: change.name,
                versions: [],
                bytes: 0,
                lazyBytes: 0,
                modules: 0,
                duplicate: false,
                change: { status: 'removed', before: change.before, delta: change.delta, versionsBefore: change.versionsBefore },
            });
        }
    }
    return rows.sort((a, b) => b.bytes - a.bytes || (a.change?.delta ?? 0) - (b.change?.delta ?? 0) || a.name.localeCompare(b.name));
}

function chunkRows(graph: BuildGraph, comparison: BuildComparison | undefined): ChunkRowDto[] {
    const loading = chunkLoading(graph.snapshot);
    const deltas = new Map(comparison?.chunks.map(change => [change.key, change.delta]) ?? []);
    return graph.snapshot.chunks.map((chunk): ChunkRowDto => {
        const entry = chunk.entryModule === undefined ? undefined : graph.module(chunk.entryModule);
        const delta = deltas.get(chunkKey(chunk));
        return {
            id: chunk.id,
            kind: chunk.kind,
            bytes: chunk.bytes,
            loading: loading.get(chunk.id) ?? 'initial',
            entry: chunk.entry,
            ...(entry === undefined ? {} : { entryModule: displayModulePath(entry) }),
            ...(delta === undefined ? {} : { delta }),
        };
    }).sort((a, b) => (a.loading === b.loading ? 0 : a.loading === 'initial' ? -1 : 1) || b.bytes - a.bytes);
}

function assetGroups(snapshot: BuildSnapshot): AssetGroupDto[] {
    const groups = new Map<AssetKindDto, AssetGroupDto>();
    for (const asset of snapshot.assets) {
        if (asset.kind === 'sourcemap') {
            continue;
        }
        const group = groups.get(asset.kind) ?? { kind: asset.kind, bytes: 0, files: [] };
        groups.set(asset.kind, { kind: asset.kind, bytes: group.bytes + asset.bytes, files: [...group.files, { id: asset.id, bytes: asset.bytes }] });
    }
    return ASSET_ORDER.flatMap((kind) => {
        const group = groups.get(kind);
        return group === undefined ? [] : [{ ...group, files: [...group.files].sort((a, b) => b.bytes - a.bytes) }];
    });
}

function duplicateRows(graph: BuildGraph): DuplicateDto[] {
    return duplicatePackages(graph).map(duplicate => ({
        name: duplicate.name,
        bytes: duplicate.bytes,
        instances: duplicate.instances.map(instance => ({
            ...(instance.version === undefined ? {} : { version: instance.version }),
            root: instance.root,
            bytes: instance.bytes,
        })),
    }));
}

function moduleChanges(current: BuildGraph, baseline: BuildGraph, comparison: BuildComparison): ModuleChangeDto[] {
    return comparison.modules.slice(0, MAX_MODULE_CHANGES).map((change) => {
        const module = current.module(change.id) ?? baseline.module(change.id);
        return {
            id: change.id,
            label: module === undefined ? change.path : displayModulePath(module),
            before: change.before,
            after: change.after,
            delta: change.delta,
        };
    });
}

function summaryOf(input: TargetInput): TargetSummaryDto {
    const { snapshot } = input.target;
    return {
        key: input.target.key,
        id: input.target.id,
        bundler: bundlerText(snapshot),
        ...(snapshot.mode === undefined ? {} : { mode: snapshot.mode }),
        createdAt: snapshot.createdAt,
        totalBytes: sizeTotals(snapshot).total,
        ...(input.failure === undefined ? {} : { failure: input.failure }),
    };
}

function isEstimated(graph: BuildGraph): boolean {
    for (const module of graph.modules()) {
        const precision = graph.precisionOf(module.id);
        if (precision !== undefined && precision !== 'bundler-reported') {
            return true;
        }
    }
    return false;
}

function totalsDto(totals: SizeTotals): SizeTotals {
    return { ...totals };
}

function selectedDashboard(input: SelectedInput): TargetDashboardDto {
    const { target, baseline, budget } = input;
    const graph = target.graph;
    const totals = sizeTotals(graph.snapshot);
    const comparison = baseline === undefined ? undefined : compareBuilds(baseline.graph, graph);
    const budgets: BudgetStateDto[] = budget === undefined ? [] : evaluateBudgets(budget, totals, graph);
    return {
        key: target.key,
        id: target.id,
        bundler: bundlerText(graph.snapshot),
        ...(graph.snapshot.mode === undefined ? {} : { mode: graph.snapshot.mode }),
        createdAt: graph.snapshot.createdAt,
        metadataPath: input.metadataPath,
        estimated: isEstimated(graph),
        totals: totalsDto(totals),
        ...(baseline === undefined ? {} : {
            baseline: {
                label: baseline.label,
                source: baseline.source,
                createdAt: baseline.graph.snapshot.createdAt,
                totals: totalsDto(sizeTotals(baseline.graph.snapshot)),
            },
        }),
        treemap: treemapOf(graph, target.id),
        packages: packageRows(graph, comparison, budget),
        chunks: chunkRows(graph, comparison),
        assets: assetGroups(graph.snapshot),
        duplicates: duplicateRows(graph),
        history: input.history.map(entry => ({
            createdAt: entry.createdAt,
            total: entry.totals.total,
            javascript: entry.totals.javascript,
            css: entry.totals.css,
            initial: entry.totals.initial,
        })),
        budgets,
        moduleChanges: comparison === undefined || baseline === undefined ? [] : moduleChanges(graph, baseline.graph, comparison),
    };
}

export function targetComparison(targets: readonly LoadedTarget[]): TargetComparisonDto | undefined {
    if (targets.length < 2) {
        return undefined;
    }
    const sizes = targets.map((target) => {
        const byName = new Map<string, number>();
        for (const instance of target.graph.packages().values()) {
            if (instance.bytes > 0) {
                byName.set(instance.name, (byName.get(instance.name) ?? 0) + instance.bytes);
            }
        }
        return byName;
    });
    const names = new Set(sizes.flatMap(byName => [...byName.keys()]));
    const rows = [...names]
        .map(name => ({ name, bytes: sizes.map(byName => byName.get(name) ?? null) }))
        .sort((a, b) => Math.max(...b.bytes.map(bytes => bytes ?? 0)) - Math.max(...a.bytes.map(bytes => bytes ?? 0)) || a.name.localeCompare(b.name))
        .slice(0, MAX_COMPARISON_ROWS);
    return { targets: targets.map(target => ({ key: target.key, id: target.id })), rows };
}

export function buildDashboardModel(inputs: DashboardInputs): DashboardModel {
    const comparison = targetComparison(inputs.targets.map(input => input.target));
    return {
        targets: inputs.targets.map(summaryOf),
        ...(inputs.selected === undefined ? {} : { selected: selectedDashboard(inputs.selected) }),
        ...(comparison === undefined ? {} : { comparison }),
        historyEnabled: inputs.historyEnabled,
    };
}
