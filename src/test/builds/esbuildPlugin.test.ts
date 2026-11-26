import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

import { ESBUILD_FIXTURE } from './support';
import { parseSnapshot } from '../../core/schema/validate';
import { trueImportCost } from '../../plugins/esbuild';
import { sanitizeTarget, snapshotRoot } from '../../plugins/shared';

import type { BuildSnapshot } from '../../core/schema/snapshot';

const directories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-esbuild-'));
    directories.push(directory);
    return directory;
}

function readSnapshot(file: string): BuildSnapshot {
    const result = parseSnapshot(JSON.parse(readFileSync(file, 'utf8')));
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.snapshot;
}

function buildWith(plugin: esbuild.Plugin, options: esbuild.BuildOptions = {}): Promise<esbuild.BuildResult> {
    return esbuild.build({
        absWorkingDir: ESBUILD_FIXTURE,
        entryPoints: ['src/extension.ts'],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        minify: true,
        external: ['vscode'],
        write: false,
        outfile: 'dist/extension.js',
        logLevel: 'silent',
        plugins: [plugin],
        ...options,
    });
}

afterAll(() => {
    for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('the esbuild plugin', () => {
    it('writes a valid snapshot with the bundler, the mode and the package versions', async () => {
        const outDir = temporaryDirectory();
        await buildWith(trueImportCost({ target: 'extension-host', outDir }));
        const snapshot = readSnapshot(path.join(outDir, 'extension-host.json'));

        expect(snapshot.target).toBe('extension-host');
        expect(snapshot.bundler).toEqual({ name: 'esbuild', version: esbuild.version });
        expect(snapshot.mode).toBe('production');
        expect(path.resolve(outDir, snapshot.root)).toBe(ESBUILD_FIXTURE);
        expect(snapshot.modules.find(module => module.packageName === 'big-library')?.packageVersion).toBe('3.2.0');
    });

    it('names the target after the output file unless told otherwise', async () => {
        const outDir = temporaryDirectory();
        await buildWith(trueImportCost({ outDir }));

        expect(existsSync(path.join(outDir, 'extension.json'))).toBe(true);
    });

    it('calls an unminified build a development build', async () => {
        const outDir = temporaryDirectory();
        await buildWith(trueImportCost({ outDir }), { minify: false });

        expect(readSnapshot(path.join(outDir, 'extension.json')).mode).toBe('development');
    });

    it('keeps its own folder out of version control', async () => {
        const outDir = path.join(temporaryDirectory(), '.true-import-cost');
        await buildWith(trueImportCost({ outDir }));

        expect(readFileSync(path.join(outDir, '.gitignore'), 'utf8')).toBe('*\n');
    });

    it('leaves the last snapshot alone when a build fails', async () => {
        const outDir = temporaryDirectory();
        const file = path.join(outDir, 'extension.json');
        await buildWith(trueImportCost({ outDir }));
        const before = readFileSync(file, 'utf8');
        const modified = statSync(file).mtimeMs;

        await expect(buildWith(trueImportCost({ outDir }), {
            entryPoints: undefined,
            stdin: { contents: 'export const broken = ;', resolveDir: ESBUILD_FIXTURE, loader: 'ts' },
        })).rejects.toThrow();

        expect(readFileSync(file, 'utf8')).toBe(before);
        expect(statSync(file).mtimeMs).toBe(modified);
    });

    it('turns on the metafile itself', async () => {
        const result = await buildWith(trueImportCost({ outDir: temporaryDirectory() }), { metafile: false });

        expect(result.metafile).toBeDefined();
    });
});

describe('the plugins\' shared helpers', () => {
    it('makes a target name safe to use as a file name', () => {
        expect(sanitizeTarget(' extension host ')).toBe('extension-host');
        expect(sanitizeTarget('../../etc/passwd')).toBe('..-..-etc-passwd');
        expect(sanitizeTarget('***')).toBe('build');
    });

    it('records the build root relative to the snapshot file', () => {
        expect(snapshotRoot('/work/app/.true-import-cost/web.json', '/work/app')).toBe('..');
        expect(snapshotRoot('/work/app/web.json', '/work/app')).toBe('.');
    });
});
