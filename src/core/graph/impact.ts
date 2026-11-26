import { followsEagerly, followsInclusion, reachableFrom } from './reachability';
import { PRECISION_RANK } from '../schema/snapshot';

import type { BuildGraph } from './buildGraph';
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

function restOfBuild(graph: BuildGraph, importerIds: readonly string[], moduleId: string): Set<string> {
    const importers = new Set(importerIds);
    return reachableFrom(graph, graph.entries, edge =>
        followsInclusion(edge) && !(edge.resolvedModule === moduleId && importers.has(edge.importer)));
}

function summarize(graph: BuildGraph, moduleId: string, eager: ReadonlySet<string>, all: ReadonlySet<string>, rest: ReadonlySet<string>): ImportImpact {
    let bundledBytes = 0;
    let exclusiveBytes = 0;
    let retainedModuleCount = 0;
    let exclusiveModuleCount = 0;
    let precision: MeasurementPrecision | undefined;
    const shares = new Map<string, { key: string | undefined; name: string | undefined; version?: string; bytes: number }>();

    for (const id of eager) {
        const bytes = graph.bytesOf(id);
        if (bytes <= 0) {
            continue;
        }
        bundledBytes += bytes;
        retainedModuleCount++;
        if (!rest.has(id)) {
            exclusiveBytes += bytes;
            exclusiveModuleCount++;
        }
        const modulePrecision = graph.precisionOf(id);
        if (modulePrecision !== undefined && (precision === undefined || PRECISION_RANK[modulePrecision] > PRECISION_RANK[precision])) {
            precision = modulePrecision;
        }
        const module = graph.module(id);
        const shareKey = module?.packageRoot ?? '';
        const share = shares.get(shareKey);
        if (share) {
            share.bytes += bytes;
        } else {
            shares.set(shareKey, {
                key: module?.packageRoot,
                name: module?.packageName,
                ...(module?.packageVersion === undefined ? {} : { version: module.packageVersion }),
                bytes,
            });
        }
    }

    let lazyBytes = 0;
    for (const id of all) {
        if (!eager.has(id)) {
            lazyBytes += graph.bytesOf(id);
        }
    }

    return {
        moduleId,
        bundledBytes,
        lazyBytes,
        exclusiveBytes,
        sharedBytes: bundledBytes - exclusiveBytes,
        moduleCount: eager.size,
        retainedModuleCount,
        exclusiveModuleCount,
        ...(precision === undefined ? {} : { precision }),
        packages: [...shares.values()].sort((a, b) => b.bytes - a.bytes),
    };
}

export function importImpact(graph: BuildGraph, importerIds: readonly string[], moduleId: string): ImportImpact {
    const key = `${[...importerIds].sort().join('\u0001')}\u0002${moduleId}`;
    return cached(graph, key, () => summarize(
        graph,
        moduleId,
        reachableFrom(graph, [moduleId], followsEagerly),
        reachableFrom(graph, [moduleId], followsInclusion),
        restOfBuild(graph, importerIds, moduleId),
    ));
}

export function wholeModule(moduleId: string): ImportScope {
    return { moduleId, passThrough: [], eagerRoots: [moduleId], lazyRoots: [] };
}

function scopeKey(scope: ImportScope): string {
    return [scope.moduleId, ...[scope.passThrough, scope.eagerRoots, scope.lazyRoots].map(ids => [...ids].sort().join('\u0001'))].join('\u0002');
}

function eagerModules(graph: BuildGraph, scope: ImportScope): Set<string> {
    return new Set([...scope.passThrough, ...reachableFrom(graph, scope.eagerRoots, followsEagerly)]);
}

function includedModules(graph: BuildGraph, scope: ImportScope): Set<string> {
    return new Set([...scope.passThrough, ...reachableFrom(graph, [...scope.eagerRoots, ...scope.lazyRoots], followsInclusion)]);
}

export function scopedImpact(graph: BuildGraph, importerIds: readonly string[], scope: ImportScope, alsoKept: readonly ImportScope[] = []): ImportImpact {
    const key = `scoped\u0003${[...importerIds].sort().join('\u0001')}\u0003${scopeKey(scope)}\u0003${alsoKept.map(scopeKey).sort().join('\u0004')}`;
    return cached(graph, key, () => {
        const rest = restOfBuild(graph, importerIds, scope.moduleId);
        for (const kept of alsoKept) {
            for (const id of includedModules(graph, kept)) {
                rest.add(id);
            }
        }
        return summarize(graph, scope.moduleId, eagerModules(graph, scope), includedModules(graph, scope), rest);
    });
}
