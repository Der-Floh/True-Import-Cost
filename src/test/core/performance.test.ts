import { beforeAll, describe, expect, it } from 'vitest';

import { largeBuild } from './support/largeBuild';
import { normalizeMetadata } from '../../core/adapters/registry';
import { attributeImport, locateDocument } from '../../core/attribution/attribute';
import { compareBuilds } from '../../core/compare';
import { BuildGraph } from '../../core/graph/buildGraph';
import { adoptPrecomputed, precomputeGraph } from '../../core/graph/precomputed';

import type { ImportCost } from '../../core/attribution/attribute';
import type { BuildSnapshot } from '../../core/schema/snapshot';
import type { LargeBuild } from './support/largeBuild';

const MODULES = 30_000;

const BUDGET_MS = {
    normalize: 6_000,
    graph: 1_500,
    firstDocument: 3_000,
    nextDocument: 500,
    precompute: 3_000,
    compare: 1_500,
} as const;

let build: LargeBuild;
let snapshot: BuildSnapshot;

function timed<T>(work: () => T): { readonly result: T; readonly ms: number } {
    const start = performance.now();
    const result = work();
    return { result, ms: performance.now() - start };
}

function costsOf(graph: BuildGraph, path: string): ImportCost[] {
    const location = locateDocument(graph, path);
    if (!location) {
        throw new Error(`the build has no module at ${path}`);
    }
    return location.importerIds.flatMap(id => graph.importsOf(id)).map(edge => attributeImport(location, {
        specifier: edge.specifier ?? '',
        kind: edge.kind === 'dynamic' ? 'dynamic' : 'static',
        typeOnly: false,
    }));
}

beforeAll(async () => {
    build = largeBuild(MODULES);
    const start = performance.now();
    const normalized = await normalizeMetadata(JSON.parse(JSON.stringify(build.metafile)), { target: 'large', createdAt: 0 });
    const ms = performance.now() - start;
    if (!normalized.ok) {
        throw new Error(normalized.error);
    }
    snapshot = normalized.snapshot;
    expect(ms, 'reading the esbuild metadata').toBeLessThan(BUDGET_MS.normalize);
}, 60_000);

describe(`performance on a build of ${MODULES.toLocaleString('en-US')} modules`, () => {
    it('reads the metadata and builds the graph within budget', () => {
        const { result: graph, ms } = timed(() => new BuildGraph(snapshot));

        expect(graph.moduleCount).toBe(MODULES);
        expect(ms).toBeLessThan(BUDGET_MS.graph);
    });

    it('costs every import of the first document within budget, indexes included', () => {
        const graph = new BuildGraph(snapshot);

        const { result: costs, ms } = timed(() => costsOf(graph, build.entry));

        expect(costs.length).toBeGreaterThan(50);
        expect(costs.every(cost => cost.status === 'bundled')).toBe(true);
        expect(ms).toBeLessThan(BUDGET_MS.firstDocument);
    });

    it('costs the imports of the next document within budget', () => {
        const graph = new BuildGraph(snapshot);
        costsOf(graph, build.entry);

        const { result: costs, ms } = timed(() => costsOf(graph, build.deepFile));

        expect(costs.length).toBeGreaterThan(0);
        expect(ms).toBeLessThan(BUDGET_MS.nextDocument);
    });

    it('indexes the graph in the background within budget, and the host adopts the indexes at once', () => {
        const { result: precomputed, ms } = timed(() => precomputeGraph(snapshot));
        const graph = new BuildGraph(snapshot);

        const adoption = timed(() => adoptPrecomputed(graph, precomputed));

        expect(ms).toBeLessThan(BUDGET_MS.precompute);
        expect(adoption.result).toBe(true);
        expect(adoption.ms).toBeLessThan(50);
    });

    it('compares two builds within budget', () => {
        const { result: comparison, ms } = timed(() => compareBuilds(new BuildGraph(snapshot), new BuildGraph(snapshot)));

        expect(comparison).toBeDefined();
        expect(ms).toBeLessThan(BUDGET_MS.compare);
    });
});
