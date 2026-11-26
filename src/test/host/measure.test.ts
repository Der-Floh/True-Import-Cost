import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { activateExtension, settle } from './support/extension';
import { esbuildMetafile, externalImport, staticImport } from './support/metafile';
import { lines, writeJson, writeSource } from './support/workspace';
import { normalizeEsbuildMetafile } from '../../core/adapters/esbuild';
import { fingerprint } from '../../core/hash';
import { MEASURE_ENV, measureReportFile, parseMeasureRequest } from '../../core/measureProtocol';
import { parseMeasurement } from '../../core/measurement';
import { parseStandaloneJob, STANDALONE_ENV } from '../../core/standaloneProtocol';
import {
    cancelRunningProgress,
    changeSetting,
    flushErrorMessages,
    flushInformationMessages,
    flushProgress,
    flushWarningMessages,
    readVirtualFile,
    setActiveTextEditor,
    setQuickPickChoice,
    setVirtualFile,
    setWarningMessageAnswer,
    setWorkspaceFolders,
    setWorkspaceTrusted,
    virtualFilePaths,
} from '../__mocks__/vscode';

import type { ActiveExtension } from './support/extension';
import type { BuildSnapshot } from '../../core/schema/snapshot';
import type { BuildOutcome, BuildRun } from '../../extension/measure/buildRunner';
import type { FakeTextDocument } from '../__mocks__/vscode';
import type { EsbuildMetafile } from './support/metafile';

type FakeBehaviour = 'build' | 'fail' | 'skip-file' | 'cancel' | 'wait';

interface FakeState {
    readonly runs: { readonly command: string; readonly cwd: string; readonly edits: number }[];
    behaviour: FakeBehaviour;
    standalone: unknown;
    readonly standaloneJobs: unknown[];
}

const fake = vi.hoisted((): FakeState => ({ runs: [], behaviour: 'build', standalone: undefined, standaloneJobs: [] }));

vi.mock('../../extension/measure/buildRunner', () => ({
    runBuild: (run: BuildRun) => fakeBuild(run),
}));

const METADATA = '/w/.true-import-cost/extension-host.json';

const KEY = vscode.Uri.file(METADATA).toString();

const SOURCE = lines(
    "import * as vscode from 'vscode';",
    "import { chunk } from 'lodash';",
    "import { log } from './log';",
    "export * from './log';",
    '',
    'log(chunk([1, 2], 1), vscode.version);',
);

const ALWAYS = 'Always Allow in This Workspace';

function app(withLodash: boolean): EsbuildMetafile {
    return esbuildMetafile({
        entry: 'src/extension.ts',
        outfile: 'out/extension.js',
        inputs: {
            'src/extension.ts': {
                output: withLodash ? 1_200 : 1_150,
                imports: [externalImport('vscode'), ...(withLodash ? [staticImport('lodash', 'node_modules/lodash/lodash.js')] : []), staticImport('./log', 'src/log.ts')],
            },
            'src/log.ts': { output: 300 },
            ...(withLodash ? { 'node_modules/lodash/lodash.js': { output: 70_000 } } : {}),
        },
    });
}

function snapshotOf(metafile: EsbuildMetafile): BuildSnapshot {
    return normalizeEsbuildMetafile(metafile, { target: 'extension-host', createdAt: Date.now(), root: '..', bundler: { name: 'esbuild', version: '0.25.0' }, mode: 'production' });
}

function fakeStandalone(run: BuildRun, jobFile: string): Promise<BuildOutcome> {
    const job = parseStandaloneJob(JSON.parse(readVirtualFile(jobFile) ?? 'null'));
    if (!job) {
        throw new Error('no standalone job');
    }
    fake.standaloneJobs.push({ ...job, command: run.command, electron: run.env.ELECTRON_RUN_AS_NODE });
    setVirtualFile(job.resultFile, JSON.stringify(fake.standalone));
    return Promise.resolve({ status: 'succeeded' });
}

async function fakeBuild(run: BuildRun): Promise<BuildOutcome> {
    const standaloneJob = run.env[STANDALONE_ENV];
    if (standaloneJob !== undefined) {
        return fakeStandalone(run, standaloneJob);
    }
    const request = parseMeasureRequest(JSON.parse(readVirtualFile(run.env[MEASURE_ENV] ?? '') ?? 'null'));
    if (!request) {
        throw new Error('no measurement request');
    }
    fake.runs.push({ command: run.command, cwd: run.cwd, edits: request.edits.length });
    run.onOutput?.(`building with ${request.edits.length} edits`);
    if (fake.behaviour === 'fail') {
        return { status: 'failed', detail: 'exit code 1' };
    }
    if (fake.behaviour === 'cancel') {
        cancelRunningProgress();
        return { status: 'cancelled' };
    }
    if (fake.behaviour === 'wait') {
        return new Promise((resolve) => {
            run.signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
        });
    }
    const without = request.edits.length > 0;
    const snapshotFile = `${request.outDir}/extension-host.json`;
    const files = request.edits.map(edit => edit.file);
    setVirtualFile(snapshotFile, JSON.stringify(snapshotOf(app(!without))));
    setVirtualFile(measureReportFile(snapshotFile), JSON.stringify({
        version: 1,
        target: 'extension-host',
        applied: fake.behaviour === 'skip-file' ? [] : files,
        missing: fake.behaviour === 'skip-file' ? files : [],
    }));
    return Promise.resolve({ status: 'succeeded' });
}

function storedMeasurements(): unknown[] {
    const stored = readVirtualFile(`/storage/workspace/measurements/${fingerprint(KEY)}.json`);
    return stored === undefined ? [] : (JSON.parse(stored) as { measurements: unknown[] }).measurements;
}

async function measure(specifier = 'lodash', needle = "import { chunk } from 'lodash';"): Promise<void> {
    await vscode.commands.executeCommand('trueImportCost.measureImport', {
        target: KEY,
        uri: vscode.Uri.file('/w/src/extension.ts').toString(),
        specifier,
        start: SOURCE.indexOf(needle),
    });
    await settle();
}

let source: FakeTextDocument;
let active: ActiveExtension;

beforeEach(async () => {
    fake.runs.length = 0;
    fake.behaviour = 'build';
    fake.standaloneJobs.length = 0;
    fake.standalone = { ok: true, bundler: 'esbuild 0.28.2', whole: { bytes: 70_000, gzipBytes: 24_000 }, imported: { bytes: 2_000, gzipBytes: 900 } };
    setWorkspaceFolders('/w');
    writeJson(METADATA, snapshotOf(app(true)));
    writeJson('/w/package.json', { name: 'app', scripts: { build: 'node esbuild.mjs --production' } });
    setVirtualFile('/w/src/log.ts', 'export function log(...values: unknown[]): void { console.log(...values); }\n');
    source = writeSource('/w/src/extension.ts', SOURCE);
    active = await activateExtension();
    setWarningMessageAnswer(ALWAYS);
});

describe('measuring an import by building without it', () => {
    it('builds the target as it is and without the import, records the difference and tidies up', async () => {
        await measure();

        expect(fake.runs).toEqual([
            { command: 'npm run build', cwd: '/w', edits: 0 },
            { command: 'npm run build', cwd: '/w', edits: 1 },
        ]);
        const [measurement] = storedMeasurements().map(parseMeasurement);
        expect(measurement).toMatchObject({ method: 'built-without', importer: 'src/extension.ts', specifier: 'lodash', packages: [{ name: 'lodash', bytes: 70_000 }] });
        expect(flushInformationMessages()).toEqual(['Building "extension-host" without lodash in src/extension.ts saves 70 kB, all of it from the initial load.']);
        expect(flushProgress()).toEqual([{ title: 'Measuring lodash', cancellable: true, messages: ['building "extension-host" as it is (1 of 2)', 'building it without the import (2 of 2)'] }]);
        expect(virtualFilePaths().filter(path => path.startsWith('/storage/workspace/measure/'))).toEqual([]);
    });

    it('asks first, showing the command, and runs nothing when the answer is no', async () => {
        setWarningMessageAnswer(undefined);

        await measure();

        expect(flushWarningMessages()).toEqual(['Measure lodash by building "extension-host" twice with "npm run build"?']);
        expect(fake.runs).toEqual([]);
    });

    it('does not ask again for a command allowed for the workspace', async () => {
        await measure();
        flushWarningMessages();

        await measure();

        expect(flushWarningMessages()).toEqual([]);
        expect(fake.runs).toHaveLength(4);
    });

    it('runs nothing in Restricted Mode', async () => {
        setWorkspaceTrusted(false);

        await measure();

        expect(flushInformationMessages()).toEqual(['True Import Cost runs build tools only in a trusted workspace, and this one is in Restricted Mode.']);
        expect(fake.runs).toEqual([]);
    });

    it('measures a file with unsaved changes only once it is saved', async () => {
        await measure();
        source.edit(`${SOURCE}\n`);
        setWarningMessageAnswer('Save and Measure');

        await measure();

        expect(source.isDirty).toBe(false);
        expect(fake.runs).toHaveLength(4);
    });

    it('measures nothing while the file has unsaved changes it may not save', async () => {
        source.edit(`${SOURCE}\n`);
        setWarningMessageAnswer(undefined);

        await measure();

        expect(source.isDirty).toBe(true);
        expect(fake.runs).toEqual([]);
    });

    it('explains that a target from a raw metafile cannot be measured', async () => {
        writeJson(METADATA, app(true));
        await vscode.commands.executeCommand('trueImportCost.refresh');
        await settle();

        await measure();

        expect(flushInformationMessages()).toEqual(['Measuring needs the True Import Cost plugin in the build of "extension-host"; its metadata comes from a raw esbuild file.']);
        expect(fake.runs).toEqual([]);
    });

    it('runs the configured command in the folder of the nearest package.json', async () => {
        changeSetting('trueImportCost.measure.command', { 'extension-host': 'node build.mjs' });

        await measure();

        expect(fake.runs.map(run => [run.command, run.cwd])).toEqual([['node build.mjs', '/w'], ['node build.mjs', '/w']]);
    });

    it('asks for a command when it knows of none', async () => {
        writeJson('/w/package.json', { name: 'app' });

        await measure();

        expect(flushWarningMessages()).toEqual(['True Import Cost does not know how to build "extension-host". Set trueImportCost.measure.command to the command that builds it.']);
        expect(fake.runs).toEqual([]);
    });

    it('explains why export * cannot be taken out', async () => {
        await measure('./log', "export * from './log';");

        expect(flushInformationMessages()).toEqual(["export * from './log' has no names True Import Cost could stand in for, so it cannot be taken out."]);
        expect(fake.runs).toEqual([]);
    });

    it('reports a build that fails, and records nothing', async () => {
        fake.behaviour = 'fail';

        await measure();

        expect(flushErrorMessages()).toEqual(['True Import Cost: "npm run build" failed (exit code 1). The log has its output.']);
        expect(storedMeasurements()).toEqual([]);
    });

    it('reports a build that never loaded the file through the plugin', async () => {
        fake.behaviour = 'skip-file';

        await measure();

        expect(flushErrorMessages()).toEqual(['True Import Cost: The build of "extension-host" did not load extension.ts through the True Import Cost plugin, so it could not be built without the import.']);
        expect(storedMeasurements()).toEqual([]);
    });

    it('stops a running build when the extension shuts down', async () => {
        fake.behaviour = 'wait';
        const measuring = measure();
        await settle();
        expect(fake.runs).toHaveLength(1);

        active.deactivate();
        await measuring;

        expect(flushErrorMessages()).toEqual([]);
        expect(fake.runs).toHaveLength(1);
    });

    it('stops quietly when cancelled', async () => {
        fake.behaviour = 'cancel';

        await measure();

        expect(flushErrorMessages()).toEqual([]);
        expect(fake.runs).toHaveLength(1);
        expect(storedMeasurements()).toEqual([]);
    });
});

describe('measuring an import from two of your own builds', () => {
    it('records the difference when the build after the pinned baseline lost exactly one import', async () => {
        setActiveTextEditor(source);
        setQuickPickChoice(item => item.label.includes('Pin the current build'));
        await vscode.commands.executeCommand('trueImportCost.compareBuilds');
        await settle();

        writeJson(METADATA, snapshotOf(app(false)));
        await vscode.commands.executeCommand('trueImportCost.refresh');
        await settle();

        const [measurement] = storedMeasurements().map(parseMeasurement);
        expect(measurement).toMatchObject({ method: 'compared-builds', importer: 'src/extension.ts', specifier: 'lodash' });
        expect(fake.runs).toEqual([]);
    });
});

describe('measuring the standalone size of a package', () => {
    async function measureStandalone(specifier: string, names: readonly string[] | 'all'): Promise<void> {
        await vscode.commands.executeCommand('trueImportCost.measureStandalone', { target: KEY, specifier, names });
        await settle();
    }

    it('bundles the imported names and the whole package by themselves for the platform of the target', async () => {
        await measureStandalone('lodash', ['chunk']);

        expect(fake.standaloneJobs).toEqual([expect.objectContaining({
            cwd: '/w',
            specifier: 'lodash',
            names: ['chunk'],
            platform: 'node',
            command: expect.stringContaining('standalone.js') as unknown,
            electron: '1',
        })]);
        expect(flushWarningMessages()).toEqual(['Bundle lodash by itself to measure its standalone size?']);
        expect(flushInformationMessages()).toEqual(['Bundled by itself with esbuild 0.28.2 for Node.js, { chunk } from lodash is 2 kB minified, 900 B gzipped; the whole package is 70 kB minified, 24 kB gzipped.']);
        expect(virtualFilePaths().filter(path => path.startsWith('/storage/workspace/standalone-runs/'))).toEqual([]);
    });

    it('reports a package the bundler cannot bundle', async () => {
        fake.standalone = { ok: false, error: 'Could not resolve "lodash"' };

        await measureStandalone('lodash', 'all');

        expect(flushErrorMessages()).toEqual(['True Import Cost: lodash could not be bundled by itself: Could not resolve "lodash".']);
    });

    it('measures packages only', async () => {
        await measureStandalone('./log', 'all');

        expect(flushWarningMessages()).toEqual(['That build target is no longer loaded, or the import is not a package.']);
        expect(fake.standaloneJobs).toEqual([]);
    });
});
