import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { exclusionData } from '../../core/graph/exclusion';
import { graphIndex } from '../../core/graph/graphIndex';
import { importImpact } from '../../core/graph/impact';
import { precomputeGraph } from '../../core/graph/precomputed';
import { readMetadataFile } from '../../core/metadataFile';
import { loadTarget } from '../../extension/services/metadataLoader';
import { flushFileReads, setFileReadError, setVirtualFile, setWorkspaceFolders } from '../__mocks__/vscode';
import { esbuildMetafile, externalImport, staticImport } from './support/metafile';
import { buildSnapshot, edge } from './support/snapshot';
import { writeJson, writePackageJson } from './support/workspace';

import type { MetadataFileRequest, MetadataFileResult } from '../../core/metadataFile';
import type { LoadedTarget, LoadResult } from '../../extension/services/metadataLoader';
import type { MetadataSource } from '../../extension/services/metadataLocator';
import type { MetadataReader } from '../../extension/services/metadataReader';
import type { FakeWorkspaceFolder } from '../__mocks__/vscode';

const MB = 1024 * 1024;

const APP_METAFILE = esbuildMetafile({
    entry: 'src/main.ts',
    inputs: {
        'src/main.ts': { output: 500, imports: [staticImport('lodash', 'node_modules/lodash/lodash.js'), externalImport('vscode')] },
        'node_modules/lodash/lodash.js': { output: 70_000 },
    },
});

let folder: FakeWorkspaceFolder;

function source(path: string, overrides: Partial<MetadataSource> = {}): MetadataSource {
    return { uri: vscode.Uri.file(path), folder, maxBytes: 64 * MB, ...overrides };
}

function loaded(result: LoadResult): LoadedTarget {
    if (!result.ok) {
        throw new Error(`expected the target to load, but ${result.error}`);
    }
    return result.target;
}

function failure(result: LoadResult): string {
    expect(result.ok).toBe(false);
    return result.ok ? '' : result.error;
}

beforeEach(() => {
    [folder] = setWorkspaceFolders('/w') as [FakeWorkspaceFolder];
});

describe('loading an esbuild metafile', () => {
    it('reads it into a target named after the file, keyed by its URI', async () => {
        writeJson('/w/.true-import-cost/extension-host.json', APP_METAFILE);
        const uri = vscode.Uri.file('/w/.true-import-cost/extension-host.json');

        const target = loaded(await loadTarget(source(uri.path)));

        expect([target.key, target.id, target.adapter]).toEqual([uri.toString(), 'extension-host', 'esbuild']);
        expect(target.graph.moduleCount).toBe(2);
        expect(target.graph.bytesOf('node_modules/lodash/lodash.js')).toBe(70_000);
        expect(target.snapshot.bundler.name).toBe('esbuild');
    });

    it('finds the directory the bundler ran in from the files the metafile lists', async () => {
        writeJson('/w/packages/app/.true-import-cost/app.json', APP_METAFILE);
        setVirtualFile('/w/packages/app/src/main.ts', 'export {};');

        const target = loaded(await loadTarget(source('/w/packages/app/.true-import-cost/app.json')));

        expect(target.baseUri.path).toBe('/w/packages/app');
    });

    it('looks further up, past folders that do not hold those files', async () => {
        writeJson('/w/packages/app/build/meta/stats.json', APP_METAFILE);
        setVirtualFile('/w/packages/app/node_modules/lodash/lodash.js', 'module.exports = {};');

        const target = loaded(await loadTarget(source('/w/packages/app/build/meta/stats.json')));

        expect(target.baseUri.path).toBe('/w/packages/app');
    });

    it('falls back to the workspace folder when none of the listed files exist', async () => {
        writeJson('/w/packages/app/.true-import-cost/app.json', APP_METAFILE);

        const target = loaded(await loadTarget(source('/w/packages/app/.true-import-cost/app.json')));

        expect(target.baseUri.path).toBe('/w');
    });

    it('does not look above the workspace folder', async () => {
        [folder] = setWorkspaceFolders('/w/app') as [FakeWorkspaceFolder];
        writeJson('/w/app/.true-import-cost/app.json', APP_METAFILE);
        setVirtualFile('/w/src/main.ts', 'export {};');

        const target = loaded(await loadTarget(source('/w/app/.true-import-cost/app.json')));

        expect(target.baseUri.path).toBe('/w/app');
    });

    it('uses the root a target setting names instead of looking', async () => {
        writeJson('/w/build/meta.json', APP_METAFILE);
        setVirtualFile('/w/build/src/main.ts', 'export {};');

        const relative = loaded(await loadTarget(source('/w/build/meta.json', { setting: { metadata: 'build/meta.json', root: 'packages/app' } })));
        const absolute = loaded(await loadTarget(source('/w/build/meta.json', { setting: { metadata: 'build/meta.json', root: '/srv/app' } })));

        expect(relative.baseUri.path).toBe('/w/packages/app');
        expect(absolute.baseUri.path).toBe('/srv/app');
    });

    it('dates the build by when the metafile was written', async () => {
        writeJson('/w/.true-import-cost/app.json', APP_METAFILE, { mtime: 1_700_000_000_000 });

        const target = loaded(await loadTarget(source('/w/.true-import-cost/app.json')));

        expect(target.snapshot.createdAt).toBe(1_700_000_000_000);
    });
});

describe('loading a snapshot', () => {
    const snapshot = buildSnapshot({
        target: 'webview',
        root: '..',
        modules: [
            { path: 'src/main.ts', bytes: 900, entry: true },
            { path: 'node_modules/vue/dist/vue.runtime.esm-bundler.js', bytes: 52_000 },
        ],
        imports: [edge('src/main.ts', 'vue', 'node_modules/vue/dist/vue.runtime.esm-bundler.js')],
    });

    it("reads it into a target named after the snapshot's own target", async () => {
        writeJson('/w/web/.true-import-cost/vite.json', snapshot);

        const target = loaded(await loadTarget(source('/w/web/.true-import-cost/vite.json')));

        expect([target.id, target.adapter]).toEqual(['webview', 'snapshot']);
        expect(target.snapshot.createdAt).toBe(snapshot.createdAt);
    });

    it("resolves the snapshot's root relative to the snapshot file", async () => {
        writeJson('/w/web/.true-import-cost/vite.json', snapshot);

        const target = loaded(await loadTarget(source('/w/web/.true-import-cost/vite.json')));

        expect(target.baseUri.path).toBe('/w/web');
    });

    it('takes an absolute root as it is', async () => {
        writeJson('/w/web/.true-import-cost/vite.json', { ...snapshot, root: '/srv/web' });

        const target = loaded(await loadTarget(source('/w/web/.true-import-cost/vite.json')));

        expect(target.baseUri.path).toBe('/srv/web');
    });

    it("lets the setting's id and root win over the snapshot's", async () => {
        writeJson('/w/web/.true-import-cost/vite.json', snapshot);

        const target = loaded(await loadTarget(source('/w/web/.true-import-cost/vite.json', {
            setting: { id: 'renamed', metadata: 'web/.true-import-cost/vite.json', root: 'web/app' },
        })));

        expect([target.id, target.baseUri.path]).toEqual(['renamed', '/w/web/app']);
    });
});

describe('package versions', () => {
    it("are filled in from each package's package.json, below the base directory", async () => {
        writeJson('/w/app/.true-import-cost/app.json', APP_METAFILE);
        setVirtualFile('/w/app/src/main.ts', 'export {};');
        writePackageJson('/w/app/node_modules/lodash', '4.17.21');

        const target = loaded(await loadTarget(source('/w/app/.true-import-cost/app.json')));

        expect(target.graph.packages().get('node_modules/lodash')?.version).toBe('4.17.21');
        expect(target.snapshot.modules.find(module => module.packageName === 'lodash')?.packageVersion).toBe('4.17.21');
    });

    it('are left out when package.json has no version or is not JSON, and the target still loads', async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 100, imports: [staticImport('a', 'node_modules/a/index.js'), staticImport('b', 'node_modules/b/index.js')] },
                'node_modules/a/index.js': { output: 10 },
                'node_modules/b/index.js': { output: 10 },
            },
        }));
        writeJson('/w/node_modules/a/package.json', { name: 'a' });
        setVirtualFile('/w/node_modules/b/package.json', '{ not json');

        const target = loaded(await loadTarget(source('/w/.true-import-cost/app.json')));

        expect([...target.graph.packages().values()].map(instance => [instance.name, instance.version])).toEqual([['a', undefined], ['b', undefined]]);
    });

    it('are not read for a package whose path already carries its version', async () => {
        const path = 'node_modules/.pnpm/lodash@4.17.21/node_modules/lodash/lodash.js';
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: { 'src/main.ts': { output: 100, imports: [staticImport('lodash', path)] }, [path]: { output: 70_000 } },
        }));

        const target = loaded(await loadTarget(source('/w/.true-import-cost/app.json')));

        expect([...target.graph.packages().values()].map(instance => instance.version)).toEqual(['4.17.21']);
        expect(flushFileReads()).toEqual(['/w/.true-import-cost/app.json']);
    });
});

describe('rejecting metadata', () => {
    it('refuses a file over the size limit without reading it', async () => {
        setVirtualFile('/w/.true-import-cost/huge.json', `${JSON.stringify(APP_METAFILE)}${' '.repeat(1.5 * MB)}`);

        const error = failure(await loadTarget(source('/w/.true-import-cost/huge.json', { maxBytes: MB })));

        expect(error).toBe('the file is 2 MB, above the 1 MB limit set by trueImportCost.maxMetadataSizeMB');
        expect(flushFileReads()).toEqual([]);
    });

    it('refuses a file that grew past the size limit between its stat and its read', async () => {
        writeJson('/w/.true-import-cost/app.json', APP_METAFILE);

        // loadTarget stats the file before it returns; the read comes after the rewrite below.
        const loading = loadTarget(source('/w/.true-import-cost/app.json', { maxBytes: MB }));
        setVirtualFile('/w/.true-import-cost/app.json', `${JSON.stringify(APP_METAFILE)}${' '.repeat(2 * MB)}`);

        expect(failure(await loading)).toBe('the file grew past the size limit while it was read');
    });

    it('refuses a file that is not valid JSON', async () => {
        setVirtualFile('/w/.true-import-cost/app.json', '{ "inputs": ');

        expect(failure(await loadTarget(source('/w/.true-import-cost/app.json')))).toMatch(/^the file is not valid JSON: /);
    });

    it('refuses JSON that is neither a snapshot nor a metafile it knows', async () => {
        writeJson('/w/.true-import-cost/package-lock.json', { lockfileVersion: 3, packages: {} });

        expect(failure(await loadTarget(source('/w/.true-import-cost/package-lock.json'))))
            .toBe('the file is neither a True Import Cost snapshot nor build metadata of a supported bundler');
    });

    it('says what is wrong with a snapshot that fails validation', async () => {
        writeJson('/w/.true-import-cost/web.json', { ...buildSnapshot({ target: 'web', modules: [] }), schemaVersion: 2 });

        expect(failure(await loadTarget(source('/w/.true-import-cost/web.json')))).toMatch(/^schema version 2 is not supported/);
    });

    it('says what is wrong with a malformed metafile', async () => {
        writeJson('/w/.true-import-cost/app.json', { inputs: { 'src/main.ts': { bytes: -1, imports: [] } }, outputs: {} });

        expect(failure(await loadTarget(source('/w/.true-import-cost/app.json')))).toBe('input "src/main.ts" is not a byte count');
    });

    it('reports a file that does not exist', async () => {
        expect(failure(await loadTarget(source('/w/.true-import-cost/gone.json')))).toBe('the file does not exist');
    });

    it('reports a file that cannot be read', async () => {
        writeJson('/w/.true-import-cost/app.json', APP_METAFILE);
        setFileReadError('/w/.true-import-cost/app.json', new Error('EACCES: permission denied'));

        expect(failure(await loadTarget(source('/w/.true-import-cost/app.json')))).toBe('the file could not be read: EACCES: permission denied');
    });
});

describe('reading through a metadata reader', () => {
    function recordingReader(answer?: (request: MetadataFileRequest) => MetadataFileResult): { readonly reader: MetadataReader; readonly requests: MetadataFileRequest[] } {
        const requests: MetadataFileRequest[] = [];
        return {
            requests,
            reader: {
                read: async (bytes, request) => {
                    requests.push(request);
                    return answer ? answer(request) : readMetadataFile(bytes, request);
                },
                dispose: () => undefined,
            },
        };
    }

    it('hands the reader the file, its name, its time and the target id from the settings', async () => {
        writeJson('/w/build/meta.json', APP_METAFILE);
        const { reader, requests } = recordingReader();

        const target = loaded(await loadTarget(source('/w/build/meta.json', { setting: { metadata: 'build/meta.json', id: 'extension-host' } }), reader));

        expect(requests).toEqual([{ fileName: 'meta.json', modifiedAt: expect.any(Number) as unknown, targetId: 'extension-host' }]);
        expect(target.id).toBe('extension-host');
    });

    it('uses the graph indexes the reader built', async () => {
        writeJson('/w/.true-import-cost/app.json', APP_METAFILE);
        const plain = loaded(await loadTarget(source('/w/.true-import-cost/app.json')));
        const precomputed = precomputeGraph(plain.snapshot);
        const { reader } = recordingReader(() => ({ ok: true, snapshot: plain.snapshot, adapter: plain.adapter, fingerprint: plain.fingerprint, precomputed }));

        const target = loaded(await loadTarget(source('/w/.true-import-cost/app.json'), reader));

        expect(graphIndex(target.graph).offsets).toBe(precomputed.structure.offsets);
        expect(exclusionData(target.graph)).toBe(precomputed.exclusion);
        expect(importImpact(target.graph, ['src/main.ts'], 'node_modules/lodash/lodash.js')).toEqual(importImpact(plain.graph, ['src/main.ts'], 'node_modules/lodash/lodash.js'));
    });

    it('reports what the reader could not read', async () => {
        writeJson('/w/.true-import-cost/app.json', APP_METAFILE);
        const { reader } = recordingReader(() => ({ ok: false, error: 'True Import Cost stopped before the file was read' }));

        expect(failure(await loadTarget(source('/w/.true-import-cost/app.json'), reader))).toBe('True Import Cost stopped before the file was read');
    });
});
