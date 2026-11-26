import { byText, describeBuild } from './build';
import { REPORT_SCHEMA_VERSION, SUMMARY_FORMAT } from './model';
import { lazyBytesByModule, sizeTotals } from '../../core/chunks';
import { duplicatePackages } from '../../core/graph/duplicates';

import type { Duplicate, PackageSize, SummaryReport } from './model';
import type { BuildGraph } from '../../core/graph/buildGraph';

interface PackageDraft {
    readonly versions: Set<string>;
    bytes: number;
    lazyBytes: number;
    modules: number;
    instances: number;
}

function packageSizes(graph: BuildGraph): PackageSize[] {
    const lazy = lazyBytesByModule(graph.snapshot);
    const byName = new Map<string, PackageDraft>();
    for (const instance of graph.packages().values()) {
        if (instance.bytes <= 0) {
            continue;
        }
        const draft = byName.get(instance.name) ?? { versions: new Set<string>(), bytes: 0, lazyBytes: 0, modules: 0, instances: 0 };
        if (instance.version !== undefined) {
            draft.versions.add(instance.version);
        }
        draft.bytes += instance.bytes;
        draft.lazyBytes += instance.moduleIds.reduce((sum, id) => sum + (lazy.get(id) ?? 0), 0);
        draft.modules += instance.moduleIds.filter(id => graph.bytesOf(id) > 0).length;
        draft.instances++;
        byName.set(instance.name, draft);
    }
    return [...byName]
        .map(([name, draft]): PackageSize => ({
            name,
            versions: [...draft.versions].sort(byText),
            bytes: draft.bytes,
            lazyBytes: draft.lazyBytes,
            modules: draft.modules,
            duplicate: draft.instances > 1,
        }))
        .sort((a, b) => b.bytes - a.bytes || byText(a.name, b.name));
}

function duplicates(graph: BuildGraph): Duplicate[] {
    return duplicatePackages(graph).map(duplicate => ({
        name: duplicate.name,
        bytes: duplicate.bytes,
        instances: duplicate.instances.map(instance => ({
            ...(instance.version === undefined ? {} : { version: instance.version }),
            root: instance.root,
            bytes: instance.bytes,
        })),
    }));
}

export function summaryReport(graph: BuildGraph, top: number): SummaryReport {
    const packages = packageSizes(graph);
    return {
        format: SUMMARY_FORMAT,
        schemaVersion: REPORT_SCHEMA_VERSION,
        build: describeBuild(graph),
        totals: sizeTotals(graph.snapshot),
        packageCount: packages.length,
        packages: packages.slice(0, top),
        duplicates: duplicates(graph),
    };
}
