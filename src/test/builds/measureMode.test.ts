import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vue from '@vitejs/plugin-vue';
import * as esbuild from 'esbuild';
import { build } from 'vite';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { ESBUILD_FIXTURE, readSnapshot, VITE_FIXTURE } from './support';
import { trueImportCost as esbuildPlugin } from '../../plugins/esbuild';
import { MEASURE_ENV, MEASURE_VERSION, measureReportFile } from '../../plugins/measure';
import { trueImportCost as vitePlugin } from '../../plugins/vite';

import type { BuildSnapshot } from '../../core/schema/snapshot';
import type { MeasureReport, SourceEdit } from '../../plugins/measure';
import type { Plugin } from 'vite';

const directories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-measure-'));
    directories.push(directory);
    return directory;
}

function requestMeasurement(edits: readonly SourceEdit[] = []): string {
    const directory = temporaryDirectory();
    const outDir = path.join(directory, 'measure');
    const file = path.join(directory, 'request.json');
    writeFileSync(file, JSON.stringify({ version: MEASURE_VERSION, outDir, edits }));
    process.env[MEASURE_ENV] = file;
    return outDir;
}

function replacing(file: string, statement: string, replacement: string): SourceEdit {
    const start = readFileSync(file, 'utf8').indexOf(statement);
    expect(start, `${statement} in ${file}`).toBeGreaterThanOrEqual(0);
    return { file, start, end: start + statement.length, expected: statement, replacement };
}

function readReport(snapshotFile: string): MeasureReport {
    return JSON.parse(readFileSync(measureReportFile(snapshotFile), 'utf8')) as MeasureReport;
}

function packagesOf(snapshot: BuildSnapshot): string[] {
    return [...new Set(snapshot.modules.flatMap(module => (module.packageName === undefined ? [] : [module.packageName])))].sort();
}

function buildWithEsbuild(outfile: string): Promise<esbuild.BuildResult> {
    return esbuild.build({
        absWorkingDir: ESBUILD_FIXTURE,
        entryPoints: ['src/extension.ts'],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        minify: true,
        external: ['vscode'],
        outfile,
        logLevel: 'silent',
        plugins: [esbuildPlugin({ target: 'extension-host' })],
    });
}

function buildWithVite(outDir: string, plugins: Plugin[] = []): Promise<unknown> {
    return build({
        root: VITE_FIXTURE,
        configFile: false,
        logLevel: 'silent',
        plugins: [vue(), vitePlugin({ target: 'webview' }), ...plugins],
        build: { outDir, emptyOutDir: true },
    });
}

function modifiedAt(file: string): number | undefined {
    return existsSync(file) ? statSync(file).mtimeMs : undefined;
}

afterEach(() => {
    delete process.env[MEASURE_ENV];
});

afterAll(() => {
    for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('the esbuild plugin while True Import Cost measures', () => {
    const extension = path.join(ESBUILD_FIXTURE, 'src', 'extension.ts');

    it('writes no output, and puts its snapshot and edit report in the measurement folder instead of the usual one', async () => {
        const usual = path.join(ESBUILD_FIXTURE, '.true-import-cost', 'extension-host.json');
        const usualBefore = modifiedAt(usual);
        const outDir = requestMeasurement();
        const outfile = path.join(temporaryDirectory(), 'extension.js');

        await buildWithEsbuild(outfile);

        expect(existsSync(outfile)).toBe(false);
        expect(modifiedAt(usual)).toBe(usualBefore);
        expect(readSnapshot(path.join(outDir, 'extension-host.json')).target).toBe('extension-host');
        expect(readReport(path.join(outDir, 'extension-host.json'))).toEqual({ version: 1, target: 'extension-host', applied: [], missing: [] });
    });

    it('builds the planned file without the import, and reports the edit as applied', async () => {
        const outDir = requestMeasurement([replacing(extension, "import { used } from 'tree-lib';", 'const used = void 0;')]);

        await buildWithEsbuild(path.join(temporaryDirectory(), 'extension.js'));

        const snapshotFile = path.join(outDir, 'extension-host.json');
        expect(packagesOf(readSnapshot(snapshotFile))).not.toContain('tree-lib');
        expect(packagesOf(readSnapshot(snapshotFile))).toContain('big-library');
        expect(readReport(snapshotFile)).toMatchObject({ applied: [extension], missing: [] });
    });

    it('stops the build when the file changed after the measurement was planned', async () => {
        requestMeasurement([{ file: extension, start: 0, end: 6, expected: 'export', replacement: '' }]);

        await expect(buildWithEsbuild(path.join(temporaryDirectory(), 'extension.js'))).rejects.toThrow(/changed after True Import Cost planned the measurement/);
    });

    it('reports an edit of a file the build never loaded as missing', async () => {
        const elsewhere = path.join(VITE_FIXTURE, 'src', 'main.ts');
        const outDir = requestMeasurement([replacing(elsewhere, "import './style.css';", '')]);

        await buildWithEsbuild(path.join(temporaryDirectory(), 'extension.js'));

        expect(readReport(path.join(outDir, 'extension-host.json'))).toMatchObject({ applied: [], missing: [elsewhere] });
    });

    it('refuses a request it cannot read', () => {
        process.env[MEASURE_ENV] = path.join(temporaryDirectory(), 'missing.json');

        expect(() => esbuildPlugin()).toThrow(/cannot be read/);
    });

    it('refuses a request whose edit does not match its own offsets', () => {
        const directory = temporaryDirectory();
        const file = path.join(directory, 'request.json');
        writeFileSync(file, JSON.stringify({ version: MEASURE_VERSION, outDir: directory, edits: [{ file: extension, start: 0, end: 6, expected: 'imp', replacement: '' }] }));
        process.env[MEASURE_ENV] = file;

        expect(() => esbuildPlugin()).toThrow(/not a True Import Cost measurement request/);
    });
});

describe('the Vite plugin while True Import Cost measures', () => {
    const app = path.join(VITE_FIXTURE, 'src', 'App.vue');

    it('writes no output and builds the component without the planned import', async () => {
        const outDir = requestMeasurement([replacing(app, "import { format, parse } from 'big-library';", 'const format = void 0, parse = void 0;')]);
        const dist = path.join(temporaryDirectory(), 'dist');

        await buildWithVite(dist);

        const snapshotFile = path.join(outDir, 'webview.json');
        expect(existsSync(dist)).toBe(false);
        expect(packagesOf(readSnapshot(snapshotFile))).not.toContain('big-library');
        expect(readReport(snapshotFile)).toMatchObject({ applied: [app], missing: [] });
    });

    it('stops instead of writing when another plugin turns writing back on', async () => {
        requestMeasurement();
        const dist = path.join(temporaryDirectory(), 'dist');
        const writesAnyway: Plugin = { name: 'writes-anyway', enforce: 'post', config: () => ({ build: { write: true } }) };

        await expect(buildWithVite(dist, [writesAnyway])).rejects.toThrow(/turned writing the output back on/);
        expect(existsSync(dist)).toBe(false);
    });
});
