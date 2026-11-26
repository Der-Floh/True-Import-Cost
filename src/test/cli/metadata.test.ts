import { describe, expect, it } from 'vitest';

import { memoryEnvironment } from './support';
import { loadBuild } from '../../cli/metadata';
import { input, metafile, output, statement } from '../core/support/esbuild';
import { fixture, inPackage } from '../core/support/snapshot';

import type { MemoryFiles } from './support';
import type { LoadedBuild } from '../../cli/metadata';

const METAFILE = JSON.stringify(metafile(
    {
        'src/main.ts': input(100, [statement('node_modules/pkg/index.js', 'pkg')]),
        'node_modules/pkg/index.js': input(50),
    },
    { 'dist/main.js': output({ 'src/main.ts': 80, 'node_modules/pkg/index.js': 40 }, { entryPoint: 'src/main.ts' }) },
));

const SNAPSHOT = fixture()
    .module('src/main.ts', 80, { entry: true })
    .module('node_modules/pkg/index.js', 40, inPackage('pkg'))
    .module('node_modules/dep/index.js', 10, inPackage('dep', '9.9.9'))
    .imports('src/main.ts', 'node_modules/pkg/index.js')
    .snapshot();

function load(file: string, files: MemoryFiles, maxSizeMB = 64): Promise<LoadedBuild> {
    return loadBuild(memoryEnvironment(files, { stdout: [], stderr: [] }), file, maxSizeMB);
}

function versionOf(build: LoadedBuild, packageName: string): string | undefined {
    return build.graph.snapshot.modules.find(module => module.packageName === packageName)?.packageVersion;
}

describe('loading the metadata of a build', () => {
    it('reads a snapshot, keeps its target, and reads missing versions relative to its root', async () => {
        const build = await load('.true-import-cost/web.json', {
            '.true-import-cost/web.json': JSON.stringify({ ...SNAPSHOT, target: 'webview', root: '..' }),
            'node_modules/pkg/package.json': '{ "version": "1.2.3" }',
            'node_modules/dep/package.json': '{ "version": "0.0.1" }',
        });

        expect(build.graph.snapshot.target).toBe('webview');
        expect(versionOf(build, 'pkg')).toBe('1.2.3');
        expect(versionOf(build, 'dep')).toBe('9.9.9');
    });

    it('names a metafile\'s target after the file, and finds the directory its paths are relative to', async () => {
        const build = await load('packages/web/.true-import-cost/web-app.json', {
            'packages/web/.true-import-cost/web-app.json': METAFILE,
            'packages/web/src/main.ts': '',
            'packages/web/node_modules/pkg/package.json': '{ "version": "2.0.0" }',
            'node_modules/pkg/package.json': '{ "version": "1.0.0" }',
        });

        expect(build.graph.snapshot.target).toBe('web-app');
        expect(build.graph.snapshot.bundler).toEqual({ name: 'esbuild' });
        expect(versionOf(build, 'pkg')).toBe('2.0.0');
    });

    it('falls back to the current directory when none of the metafile\'s paths exist', async () => {
        const build = await load('downloads/meta.json', {
            'downloads/meta.json': METAFILE,
            'node_modules/pkg/package.json': '{ "version": "1.0.0" }',
        });

        expect(versionOf(build, 'pkg')).toBe('1.0.0');
    });

    it('leaves a version out when the package manifest is missing or unreadable', async () => {
        const missing = await load('meta.json', { 'meta.json': METAFILE });
        const broken = await load('meta.json', { 'meta.json': METAFILE, 'node_modules/pkg/package.json': '{ not json' });

        expect(versionOf(missing, 'pkg')).toBeUndefined();
        expect(versionOf(broken, 'pkg')).toBeUndefined();
    });

    it('ignores a byte order mark', async () => {
        const build = await load('meta.json', { 'meta.json': `﻿${METAFILE}` });

        expect(build.graph.moduleCount).toBe(2);
    });

    it.each([
        ['missing.json', {}, 'missing.json: the file does not exist'],
        ['folder', { 'folder/meta.json': METAFILE }, 'folder: not a file'],
        ['meta.json', { 'meta.json': '{ "inputs": ' }, 'meta.json: the file is not valid JSON: '],
        ['meta.json', { 'meta.json': '{ "chunks": [] }' }, 'meta.json: the file is neither a True Import Cost snapshot nor build metadata of a supported bundler'],
        ['meta.json', { 'meta.json': JSON.stringify({ ...SNAPSHOT, schemaVersion: 2 }) }, 'meta.json: schema version 2 is not supported'],
    ])('rejects %s with %j', async (file, files: MemoryFiles, message) => {
        await expect(load(file, files)).rejects.toThrow(message);
    });

    it('rejects a file above the size limit before reading it', async () => {
        const files = { 'meta.json': `${METAFILE}${' '.repeat(1024 * 1024)}` };

        await expect(load('meta.json', files, 1)).rejects.toThrow('meta.json: the file is 2 MB, above the 1 MB limit; raise it with --max-size');
        await expect(load('meta.json', files, 2)).resolves.toBeDefined();
    });
});
