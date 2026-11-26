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

const cache = new WeakMap<BuildGraph, Map<string, ImportImpact>>();

function cacheFor(graph: BuildGraph): Map<string, ImportImpact> {
    let map = cache.get(graph);
    if (!map) {
        map = new Map();
        cache.set(graph, map);
    }
    return map;
}

export function importImpact(graph: BuildGraph, importerIds: readonly string[], moduleId: string): ImportImpact {
    const key = `${[...importerIds].sort().join('\u0001')}\u0002${moduleId}`;
    const cached = cacheFor(graph).get(key);
    if (cached) {
        return cached;
    }

    const importers = new Set(importerIds);
    const eager = reachableFrom(graph, [moduleId], followsEagerly);
    const all = reachableFrom(graph, [moduleId], followsInclusion);
    const rest = reachableFrom(graph, graph.entries, edge =>
        followsInclusion(edge) && !(edge.resolvedModule === moduleId && importers.has(edge.importer)));

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

    const impact: ImportImpact = {
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
    cacheFor(graph).set(key, impact);
    return impact;
}
