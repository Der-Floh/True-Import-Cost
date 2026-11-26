import type { SizeTotals } from './chunks';
import type { BuildGraph } from './graph/buildGraph';

export interface HistoryPackage {
    readonly name: string;
    readonly bytes: number;
}

export interface HistoryEntry {
    readonly fingerprint: string;
    readonly createdAt: number;
    readonly totals: SizeTotals;
    readonly packages: readonly HistoryPackage[];
}

export const MAX_HISTORY_ENTRIES = 200;

const MAX_HISTORY_PACKAGES = 50;

const TOTAL_KEYS = ['total', 'javascript', 'css', 'assets', 'initial', 'lazy'] as const;

export function historyEntry(graph: BuildGraph, fingerprint: string, totals: SizeTotals): HistoryEntry {
    const byName = new Map<string, number>();
    for (const instance of graph.packages().values()) {
        byName.set(instance.name, (byName.get(instance.name) ?? 0) + instance.bytes);
    }
    const packages = [...byName]
        .filter(([, bytes]) => bytes > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_HISTORY_PACKAGES)
        .map(([name, bytes]) => ({ name, bytes }));
    return { fingerprint, createdAt: graph.snapshot.createdAt, totals, packages };
}

export function appendHistory(history: readonly HistoryEntry[], entry: HistoryEntry, max = MAX_HISTORY_ENTRIES): HistoryEntry[] {
    if (history.some(existing => existing.fingerprint === entry.fingerprint)) {
        return [...history];
    }
    return [...history, entry].sort((a, b) => a.createdAt - b.createdAt).slice(-max);
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseTotals(value: unknown): SizeTotals | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    if (!TOTAL_KEYS.every(key => isCount(record[key]))) {
        return undefined;
    }
    return {
        total: record.total as number,
        javascript: record.javascript as number,
        css: record.css as number,
        assets: record.assets as number,
        initial: record.initial as number,
        lazy: record.lazy as number,
    };
}

function parseEntry(value: unknown): HistoryEntry | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const totals = parseTotals(record.totals);
    if (typeof record.fingerprint !== 'string' || !isCount(record.createdAt) || !totals) {
        return undefined;
    }
    const packages = Array.isArray(record.packages)
        ? record.packages.flatMap((item: unknown): HistoryPackage[] => {
            const candidate = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {};
            return typeof candidate.name === 'string' && isCount(candidate.bytes) ? [{ name: candidate.name, bytes: candidate.bytes }] : [];
        }).slice(0, MAX_HISTORY_PACKAGES)
        : [];
    return { fingerprint: record.fingerprint, createdAt: record.createdAt, totals, packages };
}

export function parseHistory(value: unknown): HistoryEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .slice(-MAX_HISTORY_ENTRIES)
        .map(parseEntry)
        .filter((entry): entry is HistoryEntry => entry !== undefined)
        .sort((a, b) => a.createdAt - b.createdAt);
}
