import type { BuildGraph, PackageInstance } from './buildGraph';

export interface DuplicatePackage {
    readonly name: string;
    readonly instances: readonly PackageInstance[];
    readonly bytes: number;
}

const cache = new WeakMap<BuildGraph, readonly DuplicatePackage[]>();

export function duplicatePackages(graph: BuildGraph): readonly DuplicatePackage[] {
    const cached = cache.get(graph);
    if (cached) {
        return cached;
    }
    const byName = new Map<string, PackageInstance[]>();
    for (const instance of graph.packages().values()) {
        if (instance.bytes <= 0) {
            continue;
        }
        byName.set(instance.name, [...(byName.get(instance.name) ?? []), instance]);
    }
    const duplicates = [...byName.entries()]
        .filter(([, instances]) => instances.length > 1)
        .map(([name, instances]) => ({
            name,
            instances: [...instances].sort((a, b) => b.bytes - a.bytes),
            bytes: instances.reduce((sum, instance) => sum + instance.bytes, 0),
        }))
        .sort((a, b) => b.bytes - a.bytes);
    cache.set(graph, duplicates);
    return duplicates;
}

export function duplicateOf(graph: BuildGraph, packageName: string): DuplicatePackage | undefined {
    return duplicatePackages(graph).find(duplicate => duplicate.name === packageName);
}
