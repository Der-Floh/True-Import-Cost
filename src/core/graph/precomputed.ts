import { BuildGraph } from './buildGraph';
import { exclusionData, seedExclusion } from './exclusion';
import { graphStructure, seedGraphStructure } from './graphIndex';

import type { ExclusionData } from './exclusion';
import type { GraphStructure } from './graphIndex';
import type { BuildSnapshot } from '../schema/snapshot';

export interface PrecomputedGraph {
    readonly structure: GraphStructure;
    readonly exclusion: ExclusionData;
}

export function precomputeGraph(snapshot: BuildSnapshot): PrecomputedGraph {
    const graph = new BuildGraph(snapshot);
    return { structure: graphStructure(graph), exclusion: exclusionData(graph) };
}

export function adoptPrecomputed(graph: BuildGraph, precomputed: PrecomputedGraph): boolean {
    return seedGraphStructure(graph, precomputed.structure) && seedExclusion(graph, precomputed.exclusion);
}

export function buffersOf(precomputed: PrecomputedGraph): ArrayBuffer[] {
    const { structure, exclusion } = precomputed;
    return [
        structure.offsets,
        structure.targets,
        structure.eager,
        exclusion.pathOf,
        exclusion.splitKeys,
        exclusion.splitNodes,
        exclusion.enter,
        exclusion.leave,
    ].map(array => array.buffer as ArrayBuffer);
}
