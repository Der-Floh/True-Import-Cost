import { followsEagerly, followsInclusion } from './reachability';
import { PRECISION_RANK } from '../schema/snapshot';

import type { BuildGraph } from './buildGraph';

export interface ShareKey {
    readonly key: string | undefined;
    readonly name: string | undefined;
    readonly version?: string;
}

export interface GraphStructure {
    readonly offsets: Int32Array;
    readonly targets: Int32Array;
    readonly eager: Uint8Array;
}

export interface GraphIndex extends GraphStructure {
    readonly ids: readonly string[];
    readonly indexOf: ReadonlyMap<string, number>;
    readonly bytes: Float64Array;
    readonly precision: Int8Array;
    readonly share: Int32Array;
    readonly shares: readonly ShareKey[];
}

const cache = new WeakMap<BuildGraph, GraphIndex>();

const seeded = new WeakMap<BuildGraph, GraphStructure>();

function structureOf(graph: BuildGraph, ids: readonly string[], indexOf: ReadonlyMap<string, number>): GraphStructure {
    const offsets = new Int32Array(ids.length + 1);
    const targets: number[] = [];
    const eager: number[] = [];
    ids.forEach((id, index) => {
        for (const edge of graph.importsOf(id)) {
            const target = edge.resolvedModule === undefined ? undefined : indexOf.get(edge.resolvedModule);
            if (target !== undefined && followsInclusion(edge)) {
                targets.push(target);
                eager.push(followsEagerly(edge) ? 1 : 0);
            }
        }
        offsets[index + 1] = targets.length;
    });
    return { offsets, targets: Int32Array.from(targets), eager: Uint8Array.from(eager) };
}

function build(graph: BuildGraph): GraphIndex {
    const modules = [...graph.modules()];
    const ids = modules.map(module => module.id);
    const indexOf = new Map(ids.map((id, index) => [id, index]));
    const bytes = new Float64Array(ids.length);
    const precision = new Int8Array(ids.length).fill(-1);
    const share = new Int32Array(ids.length);
    const shareOf = new Map<string, number>();
    const shares: ShareKey[] = [];
    modules.forEach((module, index) => {
        bytes[index] = graph.bytesOf(module.id);
        const modulePrecision = graph.precisionOf(module.id);
        if (modulePrecision !== undefined) {
            precision[index] = PRECISION_RANK[modulePrecision];
        }
        const key = module.packageRoot ?? '';
        let known = shareOf.get(key);
        if (known === undefined) {
            known = shares.length;
            shareOf.set(key, known);
            shares.push({
                key: module.packageRoot,
                name: module.packageName,
                ...(module.packageVersion === undefined ? {} : { version: module.packageVersion }),
            });
        }
        share[index] = known;
    });
    const structure = seeded.get(graph) ?? structureOf(graph, ids, indexOf);
    seeded.delete(graph);
    return { ...structure, ids, indexOf, bytes, precision, share, shares };
}

export function graphIndex(graph: BuildGraph): GraphIndex {
    let index = cache.get(graph);
    if (!index) {
        index = build(graph);
        cache.set(graph, index);
    }
    return index;
}

export function graphStructure(graph: BuildGraph): GraphStructure {
    const { offsets, targets, eager } = graphIndex(graph);
    return { offsets, targets, eager };
}

export function seedGraphStructure(graph: BuildGraph, structure: GraphStructure): boolean {
    const fits = structure.offsets.length === graph.moduleCount + 1
        && structure.targets.length === structure.eager.length
        && structure.offsets[graph.moduleCount] === structure.targets.length;
    if (fits && !cache.has(graph)) {
        seeded.set(graph, structure);
    }
    return fits;
}

export function reachIndices(index: GraphIndex, roots: Iterable<number>, eagerOnly: boolean): number[] {
    const visited = new Uint8Array(index.ids.length);
    const order: number[] = [];
    const stack: number[] = [];
    for (const root of roots) {
        if (visited[root] === 0) {
            visited[root] = 1;
            stack.push(root);
        }
    }
    while (stack.length > 0) {
        const node = stack.pop() as number;
        order.push(node);
        const end = index.offsets[node + 1] as number;
        for (let edge = index.offsets[node] as number; edge < end; edge++) {
            const target = index.targets[edge] as number;
            if (visited[target] === 0 && (!eagerOnly || index.eager[edge] === 1)) {
                visited[target] = 1;
                stack.push(target);
            }
        }
    }
    return order;
}
