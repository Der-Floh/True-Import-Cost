import { exclusionIndex } from './exclusion';
import { graphIndex, reachIndices } from './graphIndex';
import { followsInclusion, reachableFrom } from './reachability';
import { PRECISION_RANK } from '../schema/snapshot';

import type { BuildGraph } from './buildGraph';
import type { GraphIndex, ShareKey } from './graphIndex';
import type { MeasurementPrecision } from '../schema/snapshot';

export interface PackageShare {
    readonly key: string | undefined;
    readonly name: string | undefined;
    readonly version?: string;
    readonly bytes: number;
}

export interface ImportImpact {
    readonly moduleId: string;
    readonly bundledBytes: number;
    readonly lazyBytes: number;
    readonly exclusiveBytes: number;
    readonly sharedBytes: number;
    readonly moduleCount: number;
    readonly retainedModuleCount: number;
    readonly exclusiveModuleCount: number;
    readonly precision?: MeasurementPrecision;
    readonly packages: readonly PackageShare[];
}

export interface ImportScope {
    readonly moduleId: string;
    readonly passThrough: readonly string[];
    readonly eagerRoots: readonly string[];
    readonly lazyRoots: readonly string[];
}

const cache = new WeakMap<BuildGraph, Map<string, ImportImpact>>();

function cacheFor(graph: BuildGraph): Map<string, ImportImpact> {
    let map = cache.get(graph);
    if (!map) {
        map = new Map();
        cache.set(graph, map);
    }
    return map;
}

function cached(graph: BuildGraph, key: string, compute: () => ImportImpact): ImportImpact {
    const map = cacheFor(graph);
    let impact = map.get(key);
    if (!impact) {
        impact = compute();
        map.set(key, impact);
    }
    return impact;
}

type KeptTest = (node: number) => boolean;

function restOfBuild(graph: BuildGraph, importerIds: readonly string[], moduleId: string): Set<string> {
    const importers = new Set(importerIds);
    return reachableFrom(graph, graph.entries, edge =>
        followsInclusion(edge) && !(edge.resolvedModule === moduleId && importers.has(edge.importer)));
}

function documentPathOf(graph: BuildGraph, importerIds: readonly string[]): string | undefined {
    const paths = new Set(importerIds.map(id => graph.module(id)?.path));
    const [path] = paths;
    if (paths.size !== 1 || path === undefined) {
        return undefined;
    }
    const importers = new Set(importerIds);
    const atPath = graph.modulesAt(path);
    return atPath.length === importers.size && atPath.every(module => importers.has(module.id)) ? path : undefined;
}

function keptByRestOfBuild(graph: BuildGraph, importerIds: readonly string[], moduleId: string): KeptTest {
    const index = graphIndex(graph);
    const target = index.indexOf.get(moduleId);
    const path = documentPathOf(graph, importerIds);
    if (path !== undefined && target !== undefined) {
        const exclusion = exclusionIndex(graph);
        const split = exclusion.splitOf(path, target);
        return node => exclusion.keptWithout(split, node);
    }
    const rest = restOfBuild(graph, importerIds, moduleId);
    return node => rest.has(index.ids[node] as string);
}

function nodesOf(index: GraphIndex, ids: readonly string[]): number[] {
    return ids.flatMap((id) => {
        const node = index.indexOf.get(id);
        return node === undefined ? [] : [node];
    });
}

function union(...groups: readonly (readonly number[])[]): number[] {
    return [...new Set(groups.flat())];
}

const PRECISION_BY_RANK = new Map((Object.entries(PRECISION_RANK) as [MeasurementPrecision, number][]).map(([precision, rank]) => [rank, precision]));

function summarize(index: GraphIndex, moduleId: string, eager: readonly number[], all: readonly number[], kept: KeptTest): ImportImpact {
    let bundledBytes = 0;
    let exclusiveBytes = 0;
    let retainedModuleCount = 0;
    let exclusiveModuleCount = 0;
    let rank = -1;
    const shareBytes = new Float64Array(index.shares.length);
    const touched: number[] = [];
    const eagerNodes = new Uint8Array(index.ids.length);

    for (const node of eager) {
        eagerNodes[node] = 1;
        const bytes = index.bytes[node] as number;
        if (bytes <= 0) {
            continue;
        }
        bundledBytes += bytes;
        retainedModuleCount++;
        if (!kept(node)) {
            exclusiveBytes += bytes;
            exclusiveModuleCount++;
        }
        rank = Math.max(rank, index.precision[node] as number);
        const share = index.share[node] as number;
        if (shareBytes[share] === 0) {
            touched.push(share);
        }
        shareBytes[share] = (shareBytes[share] as number) + bytes;
    }

    let lazyBytes = 0;
    for (const node of all) {
        if (eagerNodes[node] === 0) {
            lazyBytes += index.bytes[node] as number;
        }
    }

    const precision = PRECISION_BY_RANK.get(rank);
    return {
        moduleId,
        bundledBytes,
        lazyBytes,
        exclusiveBytes,
        sharedBytes: bundledBytes - exclusiveBytes,
        moduleCount: eager.length,
        retainedModuleCount,
        exclusiveModuleCount,
        ...(precision === undefined ? {} : { precision }),
        packages: touched
            .map(share => ({ ...index.shares[share] as ShareKey, bytes: shareBytes[share] as number }))
            .sort((a, b) => b.bytes - a.bytes || (a.key ?? '').localeCompare(b.key ?? '')),
    };
}

export function importImpact(graph: BuildGraph, importerIds: readonly string[], moduleId: string): ImportImpact {
    const key = `${[...importerIds].sort().join('\u0001')}\u0002${moduleId}`;
    return cached(graph, key, () => {
        const index = graphIndex(graph);
        const roots = nodesOf(index, [moduleId]);
        return summarize(index, moduleId, reachIndices(index, roots, true), reachIndices(index, roots, false), keptByRestOfBuild(graph, importerIds, moduleId));
    });
}

export function wholeModule(moduleId: string): ImportScope {
    return { moduleId, passThrough: [], eagerRoots: [moduleId], lazyRoots: [] };
}

function scopeKey(scope: ImportScope): string {
    return [scope.moduleId, ...[scope.passThrough, scope.eagerRoots, scope.lazyRoots].map(ids => [...ids].sort().join('\u0001'))].join('\u0002');
}

function eagerNodesOf(index: GraphIndex, scope: ImportScope): number[] {
    return union(nodesOf(index, scope.passThrough), reachIndices(index, nodesOf(index, scope.eagerRoots), true));
}

function includedNodesOf(index: GraphIndex, scope: ImportScope): number[] {
    return union(nodesOf(index, scope.passThrough), reachIndices(index, nodesOf(index, [...scope.eagerRoots, ...scope.lazyRoots]), false));
}

export function scopedImpact(graph: BuildGraph, importerIds: readonly string[], scope: ImportScope, alsoKept: readonly ImportScope[] = []): ImportImpact {
    const key = `scoped\u0003${[...importerIds].sort().join('\u0001')}\u0003${scopeKey(scope)}\u0003${alsoKept.map(scopeKey).sort().join('\u0004')}`;
    return cached(graph, key, () => {
        const index = graphIndex(graph);
        const keptByRest = keptByRestOfBuild(graph, importerIds, scope.moduleId);
        const keptByOthers = new Uint8Array(index.ids.length);
        for (const other of alsoKept) {
            for (const node of includedNodesOf(index, other)) {
                keptByOthers[node] = 1;
            }
        }
        return summarize(index, scope.moduleId, eagerNodesOf(index, scope), includedNodesOf(index, scope), node => keptByOthers[node] === 1 || keptByRest(node));
    });
}
