import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildEsbuildFixture, ESBUILD_FIXTURE } from './support';
import { BuildGraph } from '../../core/graph/buildGraph';
import { importImpact } from '../../core/graph/impact';
import { adoptPrecomputed } from '../../core/graph/precomputed';
import { readMetadataFile } from '../../core/metadataFile';
import { WorkerMetadataReader } from '../../extension/services/metadataReader';

import type { MetadataFileRequest, MetadataFileResult } from '../../core/metadataFile';
import type { WorkerReaderOptions } from '../../extension/services/metadataReader';

const ROOT = path.resolve(ESBUILD_FIXTURE, '../../../../..');

const SCRIPT = path.join(ROOT, 'out', 'metadataWorker.js');

const REQUEST: MetadataFileRequest = { fileName: 'extension-host.json', modifiedAt: 1_700_000_000_000 };

let metafile: Uint8Array;
let directory: string;
const readers: WorkerMetadataReader[] = [];

function withoutIndexes(result: MetadataFileResult): MetadataFileResult {
    if (!result.ok) {
        return result;
    }
    const { precomputed: _precomputed, ...rest } = result;
    return rest;
}

function reader(options: Partial<WorkerReaderOptions> = {}): WorkerMetadataReader {
    const created = new WorkerMetadataReader({ script: SCRIPT, minBytes: 0, ...options });
    readers.push(created);
    return created;
}

async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error('the condition did not hold in time');
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

beforeAll(async () => {
    expect(existsSync(SCRIPT), 'the worker is built (npm run bundle)').toBe(true);
    metafile = new TextEncoder().encode(JSON.stringify((await buildEsbuildFixture()).metafile));
    directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-worker-'));
});

afterEach(() => {
    for (const created of readers.splice(0)) {
        created.dispose();
    }
});

afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
});

describe('reading build metadata in a worker thread', () => {
    it('gives the same snapshot as reading it on the extension host', async () => {
        const expected = await readMetadataFile(metafile, REQUEST);

        const result = await reader().read(metafile, REQUEST);

        expect(expected.ok).toBe(true);
        expect(withoutIndexes(result)).toEqual(expected);
    });

    it('hands over graph indexes that give the costs the host would compute', async () => {
        const result = await reader().read(metafile, REQUEST);
        if (!result.ok || !result.precomputed) {
            throw new Error('expected the worker to read the metafile and index its graph');
        }
        const adopted = new BuildGraph(result.snapshot);
        const fresh = new BuildGraph(result.snapshot);

        expect(adoptPrecomputed(adopted, result.precomputed)).toBe(true);
        const edges = result.snapshot.imports.filter(edge => edge.resolvedModule !== undefined);
        expect(edges.length).toBeGreaterThan(0);
        for (const edge of edges) {
            const importerIds = adopted.modulesAt(adopted.module(edge.importer)?.path ?? '').map(module => module.id);
            expect(importImpact(adopted, importerIds, edge.resolvedModule as string)).toEqual(importImpact(fresh, importerIds, edge.resolvedModule as string));
        }
    });

    it('answers reads that overlap, each with its own file', async () => {
        const worker = reader();
        const requests = ['a.json', 'b.json', 'c.json', 'd.json'].map((fileName): MetadataFileRequest => ({ ...REQUEST, fileName }));

        const results = await Promise.all(requests.map(request => worker.read(metafile, request)));

        expect(results.map((result: MetadataFileResult) => result.ok && result.snapshot.target)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('leaves the bytes it was given intact', async () => {
        const bytes = metafile.slice();

        await reader().read(bytes, REQUEST);

        expect(bytes).toEqual(metafile);
    });

    it('reports a file that is not JSON as the host would', async () => {
        const bytes = new TextEncoder().encode('{ "inputs": ');

        expect(await reader().read(bytes, REQUEST)).toEqual(await readMetadataFile(bytes, REQUEST));
    });

    it('reads small files on the extension host without starting a worker', async () => {
        const worker = reader({ minBytes: metafile.byteLength + 1 });

        const result = await worker.read(metafile, REQUEST);

        expect(result.ok).toBe(true);
        expect(worker.running).toBe(false);
    });

    it('stops the worker once it has been idle for a while, and starts another for the next read', async () => {
        const worker = reader({ idleMs: 20 });

        await worker.read(metafile, REQUEST);
        await waitUntil(() => !worker.running);
        const again = await worker.read(metafile, REQUEST);

        expect(again.ok).toBe(true);
    });

    it('reads on the extension host when the worker cannot start', async () => {
        const reasons: string[] = [];
        const worker = reader({ script: path.join(directory, 'missing.js'), onFallback: reason => reasons.push(reason) });

        const first = await worker.read(metafile, REQUEST);
        const second = await worker.read(metafile, REQUEST);

        expect(first).toEqual(await readMetadataFile(metafile, REQUEST));
        expect(second.ok && second.precomputed).toBeUndefined();
        expect(reasons).toHaveLength(1);
    });

    it('reads on the extension host when the worker dies during a read', async () => {
        const crashing = path.join(directory, 'crashing.js');
        writeFileSync(crashing, 'require("node:worker_threads").parentPort.on("message", () => process.exit(3));\n');
        const reasons: string[] = [];
        const worker = reader({ script: crashing, onFallback: reason => reasons.push(reason) });

        const result = await worker.read(metafile, REQUEST);

        expect(result).toEqual(await readMetadataFile(metafile, REQUEST));
        expect(reasons).toEqual([expect.stringContaining('code 3') as unknown]);
    });

    it('settles a read that is still running when it is disposed, and every read after that', async () => {
        const worker = reader();

        const pending = worker.read(metafile, REQUEST);
        worker.dispose();

        expect(await pending).toEqual({ ok: false, error: expect.stringContaining('stopped') as unknown });
        expect(await worker.read(metafile, REQUEST)).toEqual({ ok: false, error: expect.stringContaining('stopped') as unknown });
    });
});
