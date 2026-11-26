import type { LoadedTarget } from '../services/metadataLoader';
import type { ExplainArguments } from '../presentation/hoverContent';

export function subjectModules(target: LoadedTarget, args: ExplainArguments): string[] {
    const graph = target.graph;
    if (args.packageName !== undefined) {
        return [...graph.packages().values()].filter(instance => instance.name === args.packageName).flatMap(instance => instance.moduleIds);
    }
    if (args.packageRoot !== undefined) {
        return [...(graph.packages().get(args.packageRoot)?.moduleIds ?? [])];
    }
    return (args.modules ?? []).filter(id => graph.module(id) !== undefined);
}
