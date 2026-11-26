import { describe, expect, it } from 'vitest';

import { input, metafile, output, statement } from './support/esbuild';
import { fixture } from './support/snapshot';
import { answerWorkerRequest, readMetadataFile } from '../../core/metadataFile';
import { fingerprint } from '../../core/hash';

import type { MetadataFileRequest } from '../../core/metadataFile';

const METAFILE = metafile(
    {
        'src/main.ts': input(300, [statement('src/util.ts', './util')]),
        'src/util.ts': input(100),
    },
    { 'dist/main.js': output({ 'src/main.ts': 120, 'src/util.ts': 40 }, { bytes: 160, entryPoint: 'src/main.ts' }) },
);

const REQUEST: MetadataFileRequest = { fileName: 'web.json', modifiedAt: 1_700_000_000_000 };

function bytesOf(value: unknown): Uint8Array {
    return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
}

describe('reading a metadata file', () => {
    it('normalizes esbuild metadata into a snapshot named after the file', async () => {
        const text = JSON.stringify(METAFILE);

        const result = await readMetadataFile(bytesOf(text), REQUEST);

        expect(result).toMatchObject({ ok: true, adapter: 'esbuild', fingerprint: fingerprint(text) });
        expect(result.ok && result.snapshot).toMatchObject({ target: 'web', id: fingerprint(text), createdAt: REQUEST.modifiedAt });
        expect(result.ok && result.snapshot.modules.map(module => module.id).sort()).toEqual(['src/main.ts', 'src/util.ts']);
    });

    it('names the target of bundler metadata after the settings, and keeps the target a snapshot names itself', async () => {
        const snapshot = { ...fixture().module('src/main.ts', 10, { entry: true }).snapshot(), target: 'extension-host' };

        const named = await readMetadataFile(bytesOf(snapshot), REQUEST);
        const configured = await readMetadataFile(bytesOf(snapshot), { ...REQUEST, targetId: 'from-settings' });
        const metafileWithId = await readMetadataFile(bytesOf(METAFILE), { ...REQUEST, targetId: 'from-settings' });

        expect(named.ok && named.snapshot.target).toBe('extension-host');
        expect(configured.ok && configured.snapshot.target).toBe('extension-host');
        expect(metafileWithId.ok && metafileWithId.snapshot.target).toBe('from-settings');
        expect(named).toMatchObject({ ok: true, adapter: 'snapshot' });
    });

    it('says when the file is not JSON, or not metadata it can read', async () => {
        expect(await readMetadataFile(bytesOf('{ "inputs": '), REQUEST)).toEqual({ ok: false, error: expect.stringMatching(/^the file is not valid JSON: /) as unknown });
        expect(await readMetadataFile(bytesOf({ name: 'app', version: '1.0.0' }), REQUEST))
            .toEqual({ ok: false, error: 'the file is neither a True Import Cost snapshot nor build metadata of a supported bundler' });
    });
});

describe('answering a worker request', () => {
    it('sends the snapshot as JSON, under the id of the request', async () => {
        const bytes = bytesOf(METAFILE);
        const direct = await readMetadataFile(bytes, REQUEST);

        const response = await answerWorkerRequest({ id: 7, bytes, request: REQUEST });

        expect(response).toMatchObject({ id: 7, ok: true, adapter: 'esbuild' });
        expect(response.ok && JSON.parse(response.snapshot)).toEqual(direct.ok && direct.snapshot);
    });

    it('answers with the error when the file cannot be read', async () => {
        expect(await answerWorkerRequest({ id: 3, bytes: bytesOf('not json'), request: REQUEST }))
            .toEqual({ id: 3, ok: false, error: expect.stringMatching(/^the file is not valid JSON: /) as unknown });
    });

    it('answers with the error when reading throws', async () => {
        const response = await answerWorkerRequest({ id: 4, bytes: 'not bytes' as unknown as Uint8Array, request: REQUEST });

        expect(response).toEqual({ id: 4, ok: false, error: expect.any(String) as unknown });
    });
});
