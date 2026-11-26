import type { BuildDescription } from './model';
import type { BuildGraph } from '../../core/graph/buildGraph';

export function isEstimated(graph: BuildGraph): boolean {
    for (const module of graph.modules()) {
        const precision = graph.precisionOf(module.id);
        if (precision !== undefined && precision !== 'bundler-reported') {
            return true;
        }
    }
    return false;
}

export function describeBuild(graph: BuildGraph): BuildDescription {
    const { target, bundler, mode } = graph.snapshot;
    return { target, bundler, ...(mode === undefined ? {} : { mode }), estimated: isEstimated(graph) };
}

export function byText(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    return a < b ? -1 : 1;
}
