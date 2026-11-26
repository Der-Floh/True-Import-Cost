import { MetadataError } from './adapter';
import { esbuildAdapter } from './esbuild';
import { rollupAdapter } from './rollup';
import { isSnapshotLike, parseSnapshot } from '../schema/validate';

import type { BuildContext, BundlerAdapter } from './adapter';
import type { BuildSnapshot } from '../schema/snapshot';

export const snapshotAdapter: BundlerAdapter<BuildSnapshot> = {
    name: 'snapshot',
    supports: (input: unknown): input is BuildSnapshot => isSnapshotLike(input),
    normalize: (input) => {
        const result = parseSnapshot(input);
        return result.ok ? Promise.resolve(result.snapshot) : Promise.reject(new MetadataError(result.error));
    },
};

export const BUILTIN_ADAPTERS: readonly BundlerAdapter<unknown>[] = [snapshotAdapter, esbuildAdapter, rollupAdapter];

export type NormalizeResult =
    | { readonly ok: true; readonly snapshot: BuildSnapshot; readonly adapter: string }
    | { readonly ok: false; readonly error: string };

export async function normalizeMetadata(
    input: unknown,
    context: BuildContext,
    adapters: readonly BundlerAdapter<unknown>[] = BUILTIN_ADAPTERS,
): Promise<NormalizeResult> {
    const adapter = adapters.find(candidate => candidate.supports(input));
    if (!adapter) {
        return { ok: false, error: 'the file is neither a True Import Cost snapshot nor build metadata of a supported bundler' };
    }
    try {
        const normalized = await adapter.normalize(input, context);
        const validated = adapter === snapshotAdapter ? { ok: true as const, snapshot: normalized } : parseSnapshot(normalized);
        return validated.ok
            ? { ok: true, snapshot: validated.snapshot, adapter: adapter.name }
            : { ok: false, error: `${adapter.name} metadata normalised into an invalid snapshot: ${validated.error}` };
    } catch (error: unknown) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
