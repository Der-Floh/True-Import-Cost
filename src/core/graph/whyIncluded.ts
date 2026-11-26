import { followsInclusion } from './reachability';

import type { BuildGraph } from './buildGraph';
import type { ImportKind } from '../schema/snapshot';

export interface InclusionStep {
    readonly moduleId: string;
    readonly via?: ImportKind;
}

export interface InclusionChain {
    readonly steps: readonly InclusionStep[];
}

export interface InclusionReport {
    readonly reachable: boolean;
    readonly chains: readonly InclusionChain[];
    readonly directImporters: number;
}

const MAX_CHAIN_LENGTH = 64;

export function explainInclusion(graph: BuildGraph, targetIds: Iterable<string>, limit = 10): InclusionReport {
    const targets = new Set([...targetIds].filter(id => graph.module(id) !== undefined));
    const parents = new Map<string, InclusionStep & { parent?: string }>();
    const queue: string[] = [];
    for (const entry of graph.entries) {
        if (!parents.has(entry)) {
            parents.set(entry, { moduleId: entry });
            queue.push(entry);
        }
    }
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index] as string;
        for (const edge of graph.importsOf(current)) {
            const next = edge.resolvedModule;
            if (next !== undefined && !parents.has(next) && followsInclusion(edge)) {
                parents.set(next, { moduleId: next, via: edge.kind, parent: current });
                queue.push(next);
            }
        }
    }

    const chainTo = (moduleId: string): InclusionStep[] => {
        const steps: InclusionStep[] = [];
        let current: string | undefined = moduleId;
        while (current !== undefined && steps.length < MAX_CHAIN_LENGTH) {
            const step: (InclusionStep & { parent?: string }) | undefined = parents.get(current);
            if (!step) {
                break;
            }
            steps.unshift(step.via === undefined ? { moduleId: step.moduleId } : { moduleId: step.moduleId, via: step.via });
            current = step.parent;
        }
        return steps;
    };

    const chains: InclusionChain[] = [];
    const seenImporters = new Set<string>();
    let directImporters = 0;

    for (const target of targets) {
        if (graph.entries.includes(target)) {
            chains.push({ steps: [{ moduleId: target }] });
        }
        for (const edge of graph.importersOf(target)) {
            if (targets.has(edge.importer) || !followsInclusion(edge) || seenImporters.has(edge.importer)) {
                continue;
            }
            seenImporters.add(edge.importer);
            directImporters++;
            if (!parents.has(edge.importer)) {
                continue;
            }
            chains.push({ steps: [...chainTo(edge.importer), { moduleId: target, via: edge.kind }] });
        }
    }

    chains.sort((a, b) => a.steps.length - b.steps.length);
    return {
        reachable: [...targets].some(id => parents.has(id)),
        chains: chains.slice(0, limit),
        directImporters,
    };
}
