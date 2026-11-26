import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { ESBUILD_FIXTURE, readSnapshot } from './support';
import { BUNDLERS, buildFixture, WEBPACK_FIXTURE } from './webpackSupport';
import { MEASURE_ENV, MEASURE_VERSION, measureReportFile } from '../../plugins/measure';
import { TrueImportCostPlugin } from '../../plugins/webpack';

import type { Bundler, FixturePlugin } from './webpackSupport';
import type { BuildSnapshot } from '../../core/schema/snapshot';
import type { MeasureReport, SourceEdit } from '../../plugins/measure';

const directories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-webpack-measure-'));
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
    return [...new Set(snapshot.modules.flatMap(module => (module.packageName === undefined || module.contributions.length === 0 ? [] : [module.packageName])))].sort();
}

function previousOutput(): string {
    const outputPath = path.join(temporaryDirectory(), 'dist');
    mkdirSync(outputPath, { recursive: true });
    writeFileSync(path.join(outputPath, 'previous.js'), 'the output of the last real build');
    return outputPath;
}

function modifiedAt(file: string): number | undefined {
    return existsSync(file) ? statSync(file).mtimeMs : undefined;
}

function measure(bundler: Bundler, outputPath: string, plugins: readonly FixturePlugin[] = []): Promise<void> {
    return buildFixture(bundler, { outputPath, clean: true, plugins: [...plugins, new TrueImportCostPlugin({ target: 'extension-host' })] });
}

afterEach(() => {
    delete process.env[MEASURE_ENV];
});

afterAll(() => {
    for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe.each(BUNDLERS)('the plugin in %s while True Import Cost measures', (bundler) => {
    const extension = path.join(WEBPACK_FIXTURE, 'src', 'extension.js');

    it('writes no output, cleans nothing, and puts its snapshot and edit report in the measurement folder', async () => {
        const usual = path.join(WEBPACK_FIXTURE, '.true-import-cost', 'extension-host.json');
        const usualBefore = modifiedAt(usual);
        const outDir = requestMeasurement();
        const outputPath = previousOutput();

        await measure(bundler, outputPath);

        expect(readdirSync(outputPath)).toEqual(['previous.js']);
        expect(modifiedAt(usual)).toBe(usualBefore);
        expect(readSnapshot(path.join(outDir, 'extension-host.json')).bundler.name).toBe(bundler);
        expect(readReport(path.join(outDir, 'extension-host.json'))).toEqual({ version: 1, target: 'extension-host', applied: [], missing: [] });
    });

    it('builds the planned file without the import, and reports the edit as applied', async () => {
        const outDir = requestMeasurement([replacing(extension, "import { used } from 'tree-lib';", 'const used = void 0;')]);

        await measure(bundler, previousOutput());

        const snapshotFile = path.join(outDir, 'extension-host.json');
        expect(packagesOf(readSnapshot(snapshotFile))).not.toContain('tree-lib');
        expect(packagesOf(readSnapshot(snapshotFile))).toContain('big-library');
        expect(readReport(snapshotFile)).toMatchObject({ applied: [extension], missing: [] });
    });

    it('stops the build when the file changed after the measurement was planned', async () => {
        requestMeasurement([{ file: extension, start: 0, end: 6, expected: 'export', replacement: '' }]);

        await expect(measure(bundler, previousOutput())).rejects.toThrow(/changed after True Import Cost planned the measurement/);
    });

    it('reports an edit of a file the build never loaded as missing', async () => {
        const elsewhere = path.join(ESBUILD_FIXTURE, 'src', 'helper.ts');
        const outDir = requestMeasurement([replacing(elsewhere, 'export function helper', 'function helper')]);

        await measure(bundler, previousOutput());

        expect(readReport(path.join(outDir, 'extension-host.json'))).toMatchObject({ applied: [], missing: [elsewhere] });
    });

    it('stops instead of writing when another plugin turns emitting back on', async () => {
        const outDir = requestMeasurement();
        const outputPath = previousOutput();
        const emitsAnyway: FixturePlugin = {
            apply(compiler: { hooks: { shouldEmit: { tap(options: { name: string; stage: number }, callback: () => boolean): void } } }): void {
                compiler.hooks.shouldEmit.tap({ name: 'emits-anyway', stage: Number.NEGATIVE_INFINITY }, () => true);
            },
        };

        await expect(measure(bundler, outputPath, [emitsAnyway])).rejects.toThrow(/turned emitting the output back on/);
        expect(readdirSync(outputPath)).toEqual(['previous.js']);
        expect(existsSync(outDir)).toBe(false);
    });

    it('refuses a request it cannot read', () => {
        process.env[MEASURE_ENV] = path.join(temporaryDirectory(), 'missing.json');

        expect(() => new TrueImportCostPlugin()).toThrow(/cannot be read/);
    });
});
