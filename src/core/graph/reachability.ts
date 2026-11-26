import type { BuildGraph } from './buildGraph';
import type { ImportEdge } from '../schema/snapshot';

export type EdgeFilter = (edge: ImportEdge) => boolean;

export const followsInclusion: EdgeFilter = edge =>
    !edge.external && edge.resolvedModule !== undefined && edge.kind !== 'reference';

export const followsEagerly: EdgeFilter = edge => followsInclusion(edge) && edge.kind !== 'dynamic';

export function reachableFrom(graph: BuildGraph, roots: Iterable<string>, follow: EdgeFilter = followsInclusion): Set<string> {
    const visited = new Set<string>();
    const stack: string[] = [];
    for (const root of roots) {
        if (!visited.has(root) && graph.module(root)) {
            visited.add(root);
            stack.push(root);
        }
    }
    while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const edge of graph.importsOf(current)) {
            const next = edge.resolvedModule;
            if (next !== undefined && !visited.has(next) && follow(edge)) {
                visited.add(next);
                stack.push(next);
            }
        }
    }
    return visited;
}
