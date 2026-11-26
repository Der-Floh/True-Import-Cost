import { describeBuild } from './build';
import { COMPARISON_FORMAT, REPORT_SCHEMA_VERSION, TOTAL_KEYS } from './model';
import { compareBuilds } from '../../core/compare';
import { relativePath } from '../../core/paths';

import type { ChunkChange, ComparisonReport, ModuleChange, PackageChange, SizeChange, TotalKey } from './model';
import type { SizeTotals } from '../../core/chunks';
import type { ChangeStatus, ChunkDelta, ModuleDelta, PackageDelta } from '../../core/compare';
import type { BuildGraph } from '../../core/graph/buildGraph';
import type { ModuleRecord } from '../../core/schema/snapshot';

function moduleLabel(module: ModuleRecord): string {
    if (module.packageName !== undefined && module.packageRoot !== undefined) {
        return `${module.packageName}/${relativePath(module.packageRoot, module.path)}`;
    }
    return module.virtual === true ? module.id.replace(/^\0/, '') : module.path;
}

function totalsChange(before: SizeTotals, after: SizeTotals): Record<TotalKey, SizeChange> {
    const entries = TOTAL_KEYS.map((key): [TotalKey, SizeChange] => [key, { before: before[key], after: after[key], delta: after[key] - before[key] }]);
    return Object.fromEntries(entries) as Record<TotalKey, SizeChange>;
}

function isPackageChange(delta: PackageDelta): delta is PackageDelta & { readonly status: PackageChange['status'] } {
    return delta.status !== 'unchanged';
}

function packageChange(delta: PackageDelta & { readonly status: PackageChange['status'] }): PackageChange {
    const { name, status, before, after, versionsBefore, versionsAfter } = delta;
    return { name, status, before, after, delta: delta.delta, versionsBefore, versionsAfter };
}

function isChunkChange(delta: ChunkDelta): boolean {
    return delta.delta !== 0 || delta.before === undefined || delta.after === undefined;
}

function chunkChange({ before, after, bytesBefore, bytesAfter, delta }: ChunkDelta): ChunkChange {
    return { ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }), bytesBefore, bytesAfter, delta };
}

function moduleChange(change: ModuleDelta, baseline: BuildGraph, current: BuildGraph): ModuleChange {
    const module = current.module(change.id) ?? baseline.module(change.id);
    return {
        id: change.id,
        label: module === undefined ? change.path : moduleLabel(module),
        before: change.before,
        after: change.after,
        delta: change.delta,
    };
}

export function comparisonReport(baseline: BuildGraph, current: BuildGraph, top: number): ComparisonReport {
    const comparison = compareBuilds(baseline, current, Number.MAX_SAFE_INTEGER);
    const count = (status: ChangeStatus): number => comparison.packages.filter(delta => delta.status === status).length;
    const chunks = comparison.chunks.filter(isChunkChange);
    return {
        format: COMPARISON_FORMAT,
        schemaVersion: REPORT_SCHEMA_VERSION,
        baseline: describeBuild(baseline),
        current: describeBuild(current),
        totals: totalsChange(comparison.before, comparison.after),
        packages: {
            added: count('added'),
            removed: count('removed'),
            changed: count('changed'),
            unchanged: count('unchanged'),
            changes: comparison.packages.filter(isPackageChange).slice(0, top).map(packageChange),
        },
        chunks: {
            changed: chunks.length,
            changes: chunks.slice(0, top).map(chunkChange),
        },
        modules: {
            changed: comparison.modules.length,
            changes: comparison.modules.slice(0, top).map(change => moduleChange(change, baseline, current)),
        },
    };
}
