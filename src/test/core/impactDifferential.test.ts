import { describe, expect, it } from 'vitest';

import { fixture } from './support/snapshot';
import { BuildGraph } from '../../core/graph/buildGraph';
import { importImpact, scopedImpact } from '../../core/graph/impact';
import { adoptPrecomputed, buffersOf, precomputeGraph } from '../../core/graph/precomputed';
import { followsEagerly, followsInclusion, reachableFrom } from '../../core/graph/reachability';
import { PRECISION_RANK } from '../../core/schema/snapshot';

import type { ImportImpact, ImportScope, PackageShare } from '../../core/graph/impact';
import type { PrecomputedGraph } from '../../core/graph/precomputed';
import type { BuildSnapshot, ImportKind, MeasurementPrecision } from '../../core/schema/snapshot';

const GRAPHS = 400;

const KINDS: readonly ImportKind[] = ['static', 'static', 'static', 'static', 'dynamic', 'require', 'css', 'reference'];

const PRECISIONS: readonly MeasurementPrecision[] = ['bundler-reported', 'sourcemap-estimate', 'rendered-length', 'proportional-estimate'];

type Random = () => number;

function seeded(seed: number): Random {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function below(random: Random, limit: number): number {
    return Math.floor(random() * limit);
}

function pick<T>(random: Random, items: readonly T[]): T {
    return items[below(random, items.length)] as T;
}

function sample<T>(random: Random, items: readonly T[], chance: number): T[] {
    return items.filter(() => random() < chance);
}

function randomGraph(seed: number): BuildGraph {
    const random = seeded(seed);
    const count = 2 + below(random, 40);
    const ids = Array.from({ length: count }, (_, index) => `m${index}`);
    const paths: string[] = [];
    const build = fixture();
    const declaresEntries = random() < 0.85;
    ids.forEach((id, index) => {
        const path = index > 0 && random() < 0.2 ? pick(random, paths) : `src/${id}.ts`;
        paths.push(path);
        const inPackage = random() < 0.4 ? below(random, 4) : undefined;
        build.module(id, random() < 0.2 ? 0 : 1 + below(random, 1000), {
            path,
            precision: pick(random, PRECISIONS),
            ...(declaresEntries && (index === 0 || random() < 0.08) ? { entry: true } : {}),
            ...(inPackage === undefined ? {} : {
                packageName: `pkg-${inPackage}`,
                packageRoot: `node_modules/pkg-${inPackage}`,
                ...(inPackage % 2 === 0 ? { packageVersion: `1.${inPackage}.0` } : {}),
            }),
        });
    });
    for (const id of ids) {
        const edges = below(random, 5);
        for (let edge = 0; edge < edges; edge++) {
            if (random() < 0.1) {
                build.external(id, `external-${below(random, 3)}`, { kind: pick(random, KINDS) });
            } else {
                build.imports(id, pick(random, ids), { kind: pick(random, KINDS) });
            }
        }
    }
    return build.graph();
}

function referenceRest(graph: BuildGraph, importerIds: readonly string[], moduleId: string): Set<string> {
    const importers = new Set(importerIds);
    return reachableFrom(graph, graph.entries, edge =>
        followsInclusion(edge) && !(edge.resolvedModule === moduleId && importers.has(edge.importer)));
}

function referenceSummary(graph: BuildGraph, moduleId: string, eager: ReadonlySet<string>, all: ReadonlySet<string>, rest: ReadonlySet<string>): ImportImpact {
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
        const share = shares.get(module?.packageRoot ?? '');
        if (share) {
            share.bytes += bytes;
        } else {
            shares.set(module?.packageRoot ?? '', {
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
        packages: [...shares.values()],
    };
}

function referenceImpact(graph: BuildGraph, importerIds: readonly string[], moduleId: string): ImportImpact {
    return referenceSummary(
        graph,
        moduleId,
        reachableFrom(graph, [moduleId], followsEagerly),
        reachableFrom(graph, [moduleId], followsInclusion),
        referenceRest(graph, importerIds, moduleId),
    );
}

function referenceIncluded(graph: BuildGraph, scope: ImportScope): Set<string> {
    return new Set([...scope.passThrough, ...reachableFrom(graph, [...scope.eagerRoots, ...scope.lazyRoots], followsInclusion)]);
}

function referenceScoped(graph: BuildGraph, importerIds: readonly string[], scope: ImportScope, alsoKept: readonly ImportScope[]): ImportImpact {
    const rest = referenceRest(graph, importerIds, scope.moduleId);
    for (const kept of alsoKept) {
        for (const id of referenceIncluded(graph, kept)) {
            rest.add(id);
        }
    }
    const eager = new Set([...scope.passThrough, ...reachableFrom(graph, scope.eagerRoots, followsEagerly)]);
    return referenceSummary(graph, scope.moduleId, eager, referenceIncluded(graph, scope), rest);
}

function comparable(impact: ImportImpact): ImportImpact {
    const byKey = (a: PackageShare, b: PackageShare): number => (a.key ?? '').localeCompare(b.key ?? '');
    return { ...impact, packages: [...impact.packages].sort(byKey) };
}

function randomScope(random: Random, ids: readonly string[], moduleId: string): ImportScope {
    return {
        moduleId,
        passThrough: [moduleId, ...sample(random, ids, 0.1)],
        eagerRoots: sample(random, ids, 0.15),
        lazyRoots: sample(random, ids, 0.1),
    };
}

describe('import impact on random graphs', () => {
    it('matches a walk of the whole build for every import of a document', () => {
        let compared = 0;
        for (let seed = 1; seed <= GRAPHS; seed++) {
            const graph = randomGraph(seed);
            for (const edge of graph.snapshot.imports) {
                if (edge.resolvedModule === undefined) {
                    continue;
                }
                const path = graph.module(edge.importer)?.path as string;
                const importerIds = graph.modulesAt(path).map(module => module.id);
                expect(comparable(importImpact(graph, importerIds, edge.resolvedModule)), `seed ${seed}, ${path} → ${edge.resolvedModule}`)
                    .toEqual(comparable(referenceImpact(graph, importerIds, edge.resolvedModule)));
                compared++;
            }
        }
        expect(compared).toBeGreaterThan(GRAPHS * 10);
    });

    it('matches a walk of the whole build for importers that are only part of a document, or none of it', () => {
        for (let seed = 1; seed <= GRAPHS; seed++) {
            const graph = randomGraph(seed);
            const random = seeded(seed * 7919);
            const ids = [...graph.modules()].map(module => module.id);
            for (let trial = 0; trial < 8; trial++) {
                const importerIds = sample(random, ids, 0.2);
                const moduleId = pick(random, ids);
                expect(comparable(importImpact(graph, importerIds, moduleId)), `seed ${seed}, [${importerIds.join(', ')}] → ${moduleId}`)
                    .toEqual(comparable(referenceImpact(graph, importerIds, moduleId)));
            }
        }
    });

    it('matches a walk of the whole build for scoped imports kept in part by other imports', () => {
        for (let seed = 1; seed <= GRAPHS; seed++) {
            const graph = randomGraph(seed);
            const random = seeded(seed * 104729);
            const ids = [...graph.modules()].map(module => module.id);
            for (const edge of graph.snapshot.imports) {
                if (edge.resolvedModule === undefined || random() > 0.3) {
                    continue;
                }
                const path = graph.module(edge.importer)?.path as string;
                const importerIds = random() < 0.8 ? graph.modulesAt(path).map(module => module.id) : [edge.importer];
                const scope = randomScope(random, ids, edge.resolvedModule);
                const alsoKept = Array.from({ length: below(random, 3) }, () => randomScope(random, ids, edge.resolvedModule as string));
                expect(comparable(scopedImpact(graph, importerIds, scope, alsoKept)), `seed ${seed}, ${path} → ${edge.resolvedModule}`)
                    .toEqual(comparable(referenceScoped(graph, importerIds, scope, alsoKept)));
            }
        }
    });

    it('orders packages by bytes, then by install location', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/feature.ts', 10)
            .module('node_modules/b/index.js', 40, { packageName: 'b', packageRoot: 'node_modules/b' })
            .module('node_modules/a/index.js', 40, { packageName: 'a', packageRoot: 'node_modules/a' })
            .module('node_modules/c/index.js', 90, { packageName: 'c', packageRoot: 'node_modules/c' })
            .imports('src/main.ts', 'src/feature.ts')
            .imports('src/feature.ts', 'node_modules/b/index.js')
            .imports('src/feature.ts', 'node_modules/a/index.js')
            .imports('src/feature.ts', 'node_modules/c/index.js')
            .graph();

        expect(importImpact(graph, ['src/main.ts'], 'src/feature.ts').packages.map(share => share.key))
            .toEqual(['node_modules/c', 'node_modules/a', 'node_modules/b', undefined]);
    });
});

describe('import impact with indexes computed in another thread', () => {
    function received(graph: BuildGraph): { readonly graph: BuildGraph; readonly precomputed: PrecomputedGraph } {
        const precomputed = precomputeGraph(graph.snapshot);
        return {
            graph: new BuildGraph(JSON.parse(JSON.stringify(graph.snapshot)) as BuildSnapshot),
            precomputed: structuredClone(precomputed, { transfer: buffersOf(precomputed) }),
        };
    }

    it('matches a walk of the whole build once the indexes are adopted', () => {
        for (let seed = 1; seed <= GRAPHS; seed++) {
            const { graph, precomputed } = received(randomGraph(seed));
            expect(adoptPrecomputed(graph, precomputed)).toBe(true);
            for (const edge of graph.snapshot.imports) {
                if (edge.resolvedModule === undefined) {
                    continue;
                }
                const importerIds = graph.modulesAt(graph.module(edge.importer)?.path as string).map(module => module.id);
                expect(comparable(importImpact(graph, importerIds, edge.resolvedModule)), `seed ${seed}`)
                    .toEqual(comparable(referenceImpact(graph, importerIds, edge.resolvedModule)));
            }
        }
    });

    it('ignores indexes computed for a different build', () => {
        const { precomputed } = received(randomGraph(11));
        const graph = randomGraph(12);
        const [edge] = graph.snapshot.imports.filter(candidate => candidate.resolvedModule !== undefined);
        const moduleId = edge?.resolvedModule as string;
        const importerIds = graph.modulesAt(graph.module(edge?.importer as string)?.path as string).map(module => module.id);

        expect(graph.moduleCount).not.toBe(precomputed.structure.offsets.length - 1);
        expect(adoptPrecomputed(graph, precomputed)).toBe(false);
        expect(comparable(importImpact(graph, importerIds, moduleId))).toEqual(comparable(referenceImpact(graph, importerIds, moduleId)));
    });
});
