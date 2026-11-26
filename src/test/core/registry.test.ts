import { describe, expect, it } from 'vitest';

import { BUILD_CONTEXT, input, metafile, output } from './support/esbuild';
import { fixture } from './support/snapshot';
import { MetadataError } from '../../core/adapters/adapter';
import { BUILTIN_ADAPTERS, normalizeMetadata, snapshotAdapter } from '../../core/adapters/registry';
import { SNAPSHOT_FORMAT } from '../../core/schema/snapshot';

import type { BundlerAdapter } from '../../core/adapters/adapter';
import type { BuildSnapshot } from '../../core/schema/snapshot';

const SNAPSHOT = fixture()
    .module('src/main.ts', 120, { entry: true })
    .module('src/util.ts', 30)
    .imports('src/main.ts', 'src/util.ts', { specifier: './util' })
    .snapshot();

const METAFILE = metafile(
    { 'src/main.ts': input(100) },
    { 'dist/main.js': output({ 'src/main.ts': 80 }, { entryPoint: 'src/main.ts' }) },
);

const NEITHER = 'the file is neither a True Import Cost snapshot nor build metadata of a supported bundler';

function adapter(name: string, supports: boolean, normalize: () => Promise<BuildSnapshot>): BundlerAdapter<unknown> {
    return { name, supports: (_value: unknown): _value is unknown => supports, normalize };
}

describe('normalizeMetadata', () => {
    it('reads a snapshot through the snapshot adapter', async () => {
        expect(await normalizeMetadata(JSON.parse(JSON.stringify(SNAPSHOT)), BUILD_CONTEXT)).toEqual({ ok: true, snapshot: SNAPSHOT, adapter: 'snapshot' });
    });

    it('keeps the target and id of a snapshot rather than taking them from the context', async () => {
        const result = await normalizeMetadata(SNAPSHOT, { target: 'other', createdAt: 99, id: 'hash' });

        expect(result.ok && [result.snapshot.target, result.snapshot.id, result.snapshot.createdAt]).toEqual(['fixture', 'fixture@0', 0]);
    });

    it('reports why a snapshot is invalid', async () => {
        expect(await normalizeMetadata({ ...SNAPSHOT, schemaVersion: 7 }, BUILD_CONTEXT)).toEqual({
            ok: false,
            error: 'schema version 7 is not supported; this version of True Import Cost reads version 1',
        });
        expect(await normalizeMetadata({ ...SNAPSHOT, imports: [{ importer: 'src/gone.ts', kind: 'static', external: true }] }, BUILD_CONTEXT))
            .toEqual({ ok: false, error: 'an import names unknown importer "src/gone.ts"' });
    });

    it('routes anything with the snapshot format marker to the snapshot adapter, even if it looks like a metafile', async () => {
        const result = await normalizeMetadata({ format: SNAPSHOT_FORMAT, inputs: {}, outputs: {} }, BUILD_CONTEXT);

        expect(result).toEqual({ ok: false, error: 'schema version undefined is not supported; this version of True Import Cost reads version 1' });
    });

    it('normalises and validates an esbuild metafile', async () => {
        const result = await normalizeMetadata(METAFILE, BUILD_CONTEXT);

        expect(result.ok && result.adapter).toBe('esbuild');
        expect(result.ok && result.snapshot.modules.map(module => module.id)).toEqual(['src/main.ts']);
    });

    it('rejects metadata that no adapter supports', async () => {
        for (const value of [null, 'metafile', [], {}, { format: 'webpack-stats', chunks: [] }, { inputs: {} }]) {
            expect(await normalizeMetadata(value, BUILD_CONTEXT)).toEqual({ ok: false, error: NEITHER });
        }
    });

    it('turns an adapter error into a failed result', async () => {
        expect(await normalizeMetadata({ inputs: { 'a.ts': { bytes: 'many' } }, outputs: {} }, BUILD_CONTEXT))
            .toEqual({ ok: false, error: 'input "a.ts" is not a byte count' });
    });

    it('rejects an esbuild metafile whose paths are longer than a snapshot allows', async () => {
        const long = `src/${'deep/'.repeat(1000)}main.ts`;

        const result = await normalizeMetadata(metafile({ [long]: input(10) }, { 'out.js': output({ [long]: 10 }) }), BUILD_CONTEXT);

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^esbuild metadata normalised into an invalid snapshot: .*at modules\[0\]\.id/s);
    });

    it('rejects adapter output for an empty target name', async () => {
        const result = await normalizeMetadata(METAFILE, { target: '', createdAt: 0 });

        expect(!result.ok && result.error).toMatch(/^esbuild metadata normalised into an invalid snapshot: .*at target/s);
    });

    it('asks custom adapters in order and names the one that was used', async () => {
        const result = await normalizeMetadata(METAFILE, BUILD_CONTEXT, [
            adapter('declines', false, () => Promise.reject(new Error('never called'))),
            adapter('custom', true, () => Promise.resolve(SNAPSHOT)),
        ]);

        expect(result).toEqual({ ok: true, snapshot: SNAPSHOT, adapter: 'custom' });
    });

    it('validates what a custom adapter produces', async () => {
        const broken = { ...SNAPSHOT, chunks: [] };

        const result = await normalizeMetadata(METAFILE, BUILD_CONTEXT, [adapter('custom', true, () => Promise.resolve(broken))]);

        expect(result).toEqual({
            ok: false,
            error: 'custom metadata normalised into an invalid snapshot: module "src/main.ts" contributes to unknown output "dist/main.js"',
        });
    });

    it('reports failures that are not errors as text', async () => {
        const result = await normalizeMetadata(METAFILE, BUILD_CONTEXT, [adapter('custom', true, () => Promise.reject(404))]);

        expect(result).toEqual({ ok: false, error: '404' });
    });
});

describe('snapshotAdapter', () => {
    it('accepts only values with the snapshot format marker', () => {
        expect(snapshotAdapter.supports(SNAPSHOT)).toBe(true);
        expect(snapshotAdapter.supports(METAFILE)).toBe(false);
    });

    it('rejects an invalid snapshot with a metadata error', async () => {
        await expect(snapshotAdapter.normalize({ ...SNAPSHOT, modules: 'none' } as unknown as BuildSnapshot, BUILD_CONTEXT)).rejects.toBeInstanceOf(MetadataError);
    });
});

describe('BUILTIN_ADAPTERS', () => {
    it('tries snapshots first, then esbuild, then rollup, then webpack', () => {
        expect(BUILTIN_ADAPTERS.map(each => each.name)).toEqual(['snapshot', 'esbuild', 'rollup', 'webpack']);
    });
});
