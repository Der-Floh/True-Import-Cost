import type { BuildSnapshot } from './schema/snapshot';

export type ChunkLoading = 'initial' | 'lazy';

export interface SizeTotals {
    readonly total: number;
    readonly javascript: number;
    readonly css: number;
    readonly assets: number;
    readonly initial: number;
    readonly lazy: number;
}

const cache = new WeakMap<BuildSnapshot, ReadonlyMap<string, ChunkLoading>>();

export function chunkLoading(snapshot: BuildSnapshot): ReadonlyMap<string, ChunkLoading> {
    const cached = cache.get(snapshot);
    if (cached) {
        return cached;
    }
    const chunks = new Map(snapshot.chunks.map(chunk => [chunk.id, chunk]));
    const entries = snapshot.chunks.filter(chunk => chunk.entry).map(chunk => chunk.id);
    const initial = new Set<string>();
    const pending = entries.length > 0 ? entries : [...chunks.keys()];
    while (pending.length > 0) {
        const id = pending.pop() as string;
        if (initial.has(id)) {
            continue;
        }
        initial.add(id);
        const chunk = chunks.get(id);
        if (chunk) {
            pending.push(...chunk.imports, ...chunk.css);
        }
    }
    const loading = new Map(snapshot.chunks.map((chunk): [string, ChunkLoading] => [chunk.id, initial.has(chunk.id) ? 'initial' : 'lazy']));
    cache.set(snapshot, loading);
    return loading;
}

export function sizeTotals(snapshot: BuildSnapshot): SizeTotals {
    const loading = chunkLoading(snapshot);
    let javascript = 0;
    let css = 0;
    let initial = 0;
    let lazy = 0;
    for (const chunk of snapshot.chunks) {
        if (chunk.kind === 'css') {
            css += chunk.bytes;
        } else {
            javascript += chunk.bytes;
        }
        if (loading.get(chunk.id) === 'lazy') {
            lazy += chunk.bytes;
        } else {
            initial += chunk.bytes;
        }
    }
    const assets = snapshot.assets.reduce((sum, asset) => (asset.kind === 'sourcemap' ? sum : sum + asset.bytes), 0);
    return { total: javascript + css + assets, javascript, css, assets, initial, lazy };
}

export function lazyBytesByModule(snapshot: BuildSnapshot): ReadonlyMap<string, number> {
    const loading = chunkLoading(snapshot);
    const lazy = new Map<string, number>();
    for (const module of snapshot.modules) {
        const bytes = module.contributions
            .filter(contribution => loading.get(contribution.chunkId) === 'lazy')
            .reduce((sum, contribution) => sum + contribution.bytes, 0);
        if (bytes > 0) {
            lazy.set(module.id, bytes);
        }
    }
    return lazy;
}
