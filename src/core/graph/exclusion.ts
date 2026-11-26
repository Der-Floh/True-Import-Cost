import { graphIndex } from './graphIndex';

import type { BuildGraph } from './buildGraph';
import type { GraphIndex } from './graphIndex';

export interface ExclusionIndex {
    splitOf(importerPath: string, target: number): number | undefined;
    keptWithout(split: number | undefined, node: number): boolean;
}

export interface ExclusionData {
    readonly pathOf: Int32Array;
    readonly splitKeys: Float64Array;
    readonly splitNodes: Int32Array;
    readonly enter: Int32Array;
    readonly leave: Int32Array;
}

interface Adjacency {
    readonly offsets: Int32Array;
    readonly targets: Int32Array;
}

interface SplitGraph {
    readonly root: number;
    readonly successors: Adjacency;
    readonly pathOf: Int32Array;
    readonly splits: ReadonlyMap<number, number>;
}

const cache = new WeakMap<BuildGraph, { readonly data: ExclusionData; readonly index: ExclusionIndex }>();

const seeded = new WeakMap<BuildGraph, ExclusionData>();

function adjacency(nodeCount: number, sources: readonly number[], targets: readonly number[]): Adjacency {
    const offsets = new Int32Array(nodeCount + 1);
    for (const source of sources) {
        offsets[source + 1] = (offsets[source + 1] as number) + 1;
    }
    for (let node = 0; node < nodeCount; node++) {
        offsets[node + 1] = (offsets[node + 1] as number) + (offsets[node] as number);
    }
    const cursors = offsets.slice(0, nodeCount);
    const ordered = new Int32Array(sources.length);
    sources.forEach((source, edge) => {
        ordered[cursors[source] as number] = targets[edge] as number;
        cursors[source] = (cursors[source] as number) + 1;
    });
    return { offsets, targets: ordered };
}

function reversed(graph: Adjacency, nodeCount: number): Adjacency {
    const sources: number[] = [];
    const targets: number[] = [];
    for (let node = 0; node < nodeCount; node++) {
        for (let edge = graph.offsets[node] as number; edge < (graph.offsets[node + 1] as number); edge++) {
            sources.push(graph.targets[edge] as number);
            targets.push(node);
        }
    }
    return adjacency(nodeCount, sources, targets);
}

function buildSplitGraph(graph: BuildGraph, index: GraphIndex): SplitGraph {
    const moduleCount = index.ids.length;
    const root = moduleCount;
    const pathIds = new Map<string, number>();
    const pathOf = new Int32Array(moduleCount);
    const splits = new Map<number, number>();
    const splitTargets: number[] = [];
    const sources: number[] = [];
    const targets: number[] = [];
    const seenFrom = new Int32Array(moduleCount).fill(-1);
    for (let node = 0; node < moduleCount; node++) {
        const path = graph.module(index.ids[node] as string)?.path ?? '';
        let pathId = pathIds.get(path);
        if (pathId === undefined) {
            pathId = pathIds.size;
            pathIds.set(path, pathId);
        }
        pathOf[node] = pathId;
        for (let edge = index.offsets[node] as number; edge < (index.offsets[node + 1] as number); edge++) {
            const target = index.targets[edge] as number;
            if (seenFrom[target] === node) {
                continue;
            }
            seenFrom[target] = node;
            const key = pathId * moduleCount + target;
            let split = splits.get(key);
            if (split === undefined) {
                split = moduleCount + 1 + splitTargets.length;
                splits.set(key, split);
                splitTargets.push(target);
            }
            sources.push(node);
            targets.push(split);
        }
    }
    for (const id of graph.entries) {
        const entry = index.indexOf.get(id);
        if (entry !== undefined) {
            sources.push(root);
            targets.push(entry);
        }
    }
    splitTargets.forEach((target, offset) => {
        sources.push(moduleCount + 1 + offset);
        targets.push(target);
    });
    return { root, successors: adjacency(moduleCount + 1 + splitTargets.length, sources, targets), pathOf, splits };
}

function postorder(successors: Adjacency, root: number, nodeCount: number): { readonly order: Int32Array; readonly rank: Int32Array } {
    const rank = new Int32Array(nodeCount).fill(-1);
    const visited = new Uint8Array(nodeCount);
    const order: number[] = [];
    const nodes: number[] = [root];
    const cursors: number[] = [successors.offsets[root] as number];
    visited[root] = 1;
    while (nodes.length > 0) {
        const top = nodes.length - 1;
        const node = nodes[top] as number;
        const cursor = cursors[top] as number;
        if (cursor < (successors.offsets[node + 1] as number)) {
            cursors[top] = cursor + 1;
            const next = successors.targets[cursor] as number;
            if (visited[next] === 0) {
                visited[next] = 1;
                nodes.push(next);
                cursors.push(successors.offsets[next] as number);
            }
        } else {
            nodes.pop();
            cursors.pop();
            rank[node] = order.length;
            order.push(node);
        }
    }
    return { order: Int32Array.from(order), rank };
}

function immediateDominators(predecessors: Adjacency, order: Int32Array, rank: Int32Array, root: number, nodeCount: number): Int32Array {
    const idom = new Int32Array(nodeCount).fill(-1);
    idom[root] = root;
    const intersect = (first: number, second: number): number => {
        let a = first;
        let b = second;
        while (a !== b) {
            while ((rank[a] as number) < (rank[b] as number)) {
                a = idom[a] as number;
            }
            while ((rank[b] as number) < (rank[a] as number)) {
                b = idom[b] as number;
            }
        }
        return a;
    };
    let changed = true;
    while (changed) {
        changed = false;
        for (let position = order.length - 2; position >= 0; position--) {
            const node = order[position] as number;
            let candidate = -1;
            for (let edge = predecessors.offsets[node] as number; edge < (predecessors.offsets[node + 1] as number); edge++) {
                const predecessor = predecessors.targets[edge] as number;
                if (idom[predecessor] !== -1) {
                    candidate = candidate === -1 ? predecessor : intersect(predecessor, candidate);
                }
            }
            if (candidate !== -1 && idom[node] !== candidate) {
                idom[node] = candidate;
                changed = true;
            }
        }
    }
    return idom;
}

function eulerTour(idom: Int32Array, root: number, nodeCount: number): { readonly enter: Int32Array; readonly leave: Int32Array } {
    const parents: number[] = [];
    const children: number[] = [];
    for (let node = 0; node < nodeCount; node++) {
        const parent = idom[node] as number;
        if (parent !== -1 && node !== root) {
            parents.push(parent);
            children.push(node);
        }
    }
    const tree = adjacency(nodeCount, parents, children);
    const enter = new Int32Array(nodeCount).fill(-1);
    const leave = new Int32Array(nodeCount).fill(-1);
    let clock = 0;
    const nodes: number[] = [root];
    const cursors: number[] = [tree.offsets[root] as number];
    enter[root] = clock++;
    while (nodes.length > 0) {
        const top = nodes.length - 1;
        const node = nodes[top] as number;
        const cursor = cursors[top] as number;
        if (cursor < (tree.offsets[node + 1] as number)) {
            cursors[top] = cursor + 1;
            const child = tree.targets[cursor] as number;
            enter[child] = clock++;
            nodes.push(child);
            cursors.push(tree.offsets[child] as number);
        } else {
            leave[node] = clock++;
            nodes.pop();
            cursors.pop();
        }
    }
    return { enter, leave };
}

function computeExclusion(graph: BuildGraph): ExclusionData {
    const index = graphIndex(graph);
    const { root, successors, pathOf, splits } = buildSplitGraph(graph, index);
    const nodeCount = successors.offsets.length - 1;
    const { order, rank } = postorder(successors, root, nodeCount);
    const idom = immediateDominators(reversed(successors, nodeCount), order, rank, root, nodeCount);
    const { enter, leave } = eulerTour(idom, root, nodeCount);
    const keys = Float64Array.from(splits.keys()).sort();
    return { pathOf, splitKeys: keys, splitNodes: Int32Array.from(keys, key => splits.get(key) as number), enter, leave };
}

function findSplit(data: ExclusionData, key: number): number | undefined {
    let low = 0;
    let high = data.splitKeys.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        const candidate = data.splitKeys[middle] as number;
        if (candidate === key) {
            return data.splitNodes[middle];
        }
        if (candidate < key) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return undefined;
}

function indexOver(graph: BuildGraph, data: ExclusionData): ExclusionIndex {
    const { ids } = graphIndex(graph);
    const moduleCount = ids.length;
    const pathIds = new Map<string, number>();
    ids.forEach((id, node) => {
        pathIds.set(graph.module(id)?.path ?? '', data.pathOf[node] as number);
    });
    const { enter, leave } = data;
    return {
        splitOf: (importerPath, target) => {
            const pathId = pathIds.get(importerPath);
            return pathId === undefined ? undefined : findSplit(data, pathId * moduleCount + target);
        },
        keptWithout: (split, node) => {
            if (enter[node] === -1) {
                return false;
            }
            if (split === undefined) {
                return true;
            }
            return !((enter[split] as number) <= (enter[node] as number) && (leave[node] as number) <= (leave[split] as number));
        },
    };
}

function entryFor(graph: BuildGraph): { readonly data: ExclusionData; readonly index: ExclusionIndex } {
    let entry = cache.get(graph);
    if (!entry) {
        const data = seeded.get(graph) ?? computeExclusion(graph);
        seeded.delete(graph);
        entry = { data, index: indexOver(graph, data) };
        cache.set(graph, entry);
    }
    return entry;
}

export function exclusionData(graph: BuildGraph): ExclusionData {
    return entryFor(graph).data;
}

export function seedExclusion(graph: BuildGraph, data: ExclusionData): boolean {
    const fits = data.pathOf.length === graph.moduleCount
        && data.splitKeys.length === data.splitNodes.length
        && data.enter.length === data.leave.length
        && data.enter.length === graph.moduleCount + 1 + data.splitKeys.length;
    if (fits && !cache.has(graph)) {
        seeded.set(graph, data);
    }
    return fits;
}

export function exclusionIndex(graph: BuildGraph): ExclusionIndex {
    return entryFor(graph).index;
}
