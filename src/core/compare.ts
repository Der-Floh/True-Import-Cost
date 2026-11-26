import { sizeTotals } from './chunks';

import type { SizeTotals } from './chunks';
import type { BuildGraph } from './graph/buildGraph';
import type { ChunkRecord } from './schema/snapshot';

export type ChangeStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface PackageDelta {
    readonly name: string;
    readonly before: number;
    readonly after: number;
    readonly delta: number;
    readonly status: ChangeStatus;
    readonly versionsBefore: readonly string[];
    readonly versionsAfter: readonly string[];
}

export interface ChunkDelta {
    readonly key: string;
    readonly before?: string;
    readonly after?: string;
    readonly bytesBefore: number;
    readonly bytesAfter: number;
    readonly delta: number;
}

export interface ModuleDelta {
    readonly id: string;
    readonly path: string;
    readonly before: number;
    readonly after: number;
    readonly delta: number;
}

export interface BuildComparison {
    readonly before: SizeTotals;
    readonly after: SizeTotals;
    readonly packages: readonly PackageDelta[];
    readonly chunks: readonly ChunkDelta[];
    readonly modules: readonly ModuleDelta[];
}

const HASHED_NAME = /[-.]([A-Za-z0-9_-]{8})(?=\.[^./]+$)/;

export function chunkKey(chunk: ChunkRecord): string {
    if (chunk.entryModule !== undefined) {
        return `${chunk.kind}:${chunk.entryModule}`;
    }
    const match = HASHED_NAME.exec(chunk.id);
    const hash = match?.[1];
    const stable = hash !== undefined && /[A-Z0-9]/.test(hash) ? chunk.id.replace(HASHED_NAME, '') : chunk.id;
    return `${chunk.kind}:${stable}`;
}

interface PackageTotal {
    bytes: number;
    readonly versions: Set<string>;
}

function packageTotals(graph: BuildGraph): Map<string, PackageTotal> {
    const totals = new Map<string, PackageTotal>();
    for (const instance of graph.packages().values()) {
        if (instance.bytes <= 0) {
            continue;
        }
        const total = totals.get(instance.name) ?? { bytes: 0, versions: new Set<string>() };
        total.bytes += instance.bytes;
        if (instance.version !== undefined) {
            total.versions.add(instance.version);
        }
        totals.set(instance.name, total);
    }
    return totals;
}

function statusOf(before: number, after: number, versionsChanged: boolean): ChangeStatus {
    if (before === 0) {
        return 'added';
    }
    if (after === 0) {
        return 'removed';
    }
    return before === after && !versionsChanged ? 'unchanged' : 'changed';
}

function comparePackages(baseline: BuildGraph, current: BuildGraph): PackageDelta[] {
    const before = packageTotals(baseline);
    const after = packageTotals(current);
    const names = new Set([...before.keys(), ...after.keys()]);
    return [...names].map((name): PackageDelta => {
        const old = before.get(name);
        const now = after.get(name);
        const versionsBefore = [...(old?.versions ?? [])].sort();
        const versionsAfter = [...(now?.versions ?? [])].sort();
        const bytesBefore = old?.bytes ?? 0;
        const bytesAfter = now?.bytes ?? 0;
        return {
            name,
            before: bytesBefore,
            after: bytesAfter,
            delta: bytesAfter - bytesBefore,
            status: statusOf(bytesBefore, bytesAfter, versionsBefore.join() !== versionsAfter.join()),
            versionsBefore,
            versionsAfter,
        };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.after - a.after || a.name.localeCompare(b.name));
}

function compareChunks(baseline: BuildGraph, current: BuildGraph): ChunkDelta[] {
    const before = new Map(baseline.snapshot.chunks.map(chunk => [chunkKey(chunk), chunk]));
    const after = new Map(current.snapshot.chunks.map(chunk => [chunkKey(chunk), chunk]));
    const keys = new Set([...before.keys(), ...after.keys()]);
    return [...keys].map((key): ChunkDelta => {
        const old = before.get(key);
        const now = after.get(key);
        return {
            key,
            ...(old === undefined ? {} : { before: old.id }),
            ...(now === undefined ? {} : { after: now.id }),
            bytesBefore: old?.bytes ?? 0,
            bytesAfter: now?.bytes ?? 0,
            delta: (now?.bytes ?? 0) - (old?.bytes ?? 0),
        };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.bytesAfter - a.bytesAfter);
}

function compareModules(baseline: BuildGraph, current: BuildGraph, limit: number): ModuleDelta[] {
    const ids = new Set<string>();
    for (const module of baseline.modules()) {
        ids.add(module.id);
    }
    for (const module of current.modules()) {
        ids.add(module.id);
    }
    const deltas: ModuleDelta[] = [];
    for (const id of ids) {
        const before = baseline.bytesOf(id);
        const after = current.bytesOf(id);
        if (before !== after) {
            const path = current.module(id)?.path ?? baseline.module(id)?.path ?? id;
            deltas.push({ id, path, before, after, delta: after - before });
        }
    }
    return deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.id.localeCompare(b.id)).slice(0, limit);
}

export function compareBuilds(baseline: BuildGraph, current: BuildGraph, moduleLimit = 50): BuildComparison {
    return {
        before: sizeTotals(baseline.snapshot),
        after: sizeTotals(current.snapshot),
        packages: comparePackages(baseline, current),
        chunks: compareChunks(baseline, current),
        modules: compareModules(baseline, current, moduleLimit),
    };
}
