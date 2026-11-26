import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { ESBUILD_FIXTURE } from './support';
import { MEASURE_ENV, MEASURE_VERSION, measureReportFile, parseMeasureReport } from '../../core/measureProtocol';
import { parseSnapshot } from '../../core/schema/validate';
import { runBuild } from '../../extension/measure/buildRunner';
import { analyzeDocument, planRemoval } from '../../parser';

import type { BuildRun } from '../../extension/measure/buildRunner';

const ROOT = path.resolve(ESBUILD_FIXTURE, '../../../../..');

const NODE = JSON.stringify(process.execPath);

const directories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-run-'));
    directories.push(directory);
    return directory;
}

function run(command: string, options: Partial<BuildRun> = {}): Promise<Awaited<ReturnType<typeof runBuild>>> {
    return runBuild({ command, cwd: temporaryDirectory(), env: {}, timeoutMs: 60_000, ...options });
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

afterAll(() => {
    for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('running a build to measure an import', () => {
    it('builds the project in measurement mode in a process of its own, without the import and without writing', async () => {
        const plugin = path.join(ROOT, 'packages', 'esbuild', 'dist', 'index.cjs');
        expect(existsSync(plugin), 'the esbuild plugin is built (npm run bundle:packages)').toBe(true);
        const file = path.join(ESBUILD_FIXTURE, 'src', 'extension.ts');
        const text = readFileSync(file, 'utf8');
        const source = analyzeDocument('typescript', file, text, { usage: false }).imports.find(candidate => candidate.specifier === 'tree-lib');
        const removal = source === undefined ? undefined : planRemoval(text, source);
        expect(removal).toBeDefined();

        const directory = temporaryDirectory();
        const outDir = path.join(directory, 'without');
        const outfile = path.join(directory, 'dist', 'extension.js');
        const requestFile = path.join(directory, 'request.json');
        writeFileSync(requestFile, JSON.stringify({ version: MEASURE_VERSION, outDir, edits: [{ file, ...removal }] }));
        writeFileSync(path.join(directory, 'build.cjs'), [
            `const esbuild = require(${JSON.stringify(path.join(ROOT, 'node_modules', 'esbuild'))});`,
            `const { trueImportCost } = require(${JSON.stringify(plugin)});`,
            'esbuild.build({',
            `    absWorkingDir: ${JSON.stringify(ESBUILD_FIXTURE)}, entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', format: 'cjs',`,
            `    minify: true, external: ['vscode'], outfile: ${JSON.stringify(outfile)}, logLevel: 'error', plugins: [trueImportCost({ target: 'extension-host' })],`,
            '}).catch(() => process.exit(1));',
        ].join('\n'));
        const output: string[] = [];

        const outcome = await runBuild({ command: `${NODE} build.cjs`, cwd: directory, env: { [MEASURE_ENV]: requestFile }, timeoutMs: 60_000, onOutput: line => output.push(line) });

        expect(outcome, output.join('\n')).toEqual({ status: 'succeeded' });
        expect(existsSync(outfile)).toBe(false);
        const snapshotFile = path.join(outDir, 'extension-host.json');
        const snapshot = parseSnapshot(JSON.parse(readFileSync(snapshotFile, 'utf8')));
        expect(snapshot.ok && snapshot.snapshot.modules.some(module => module.packageName === 'tree-lib')).toBe(false);
        expect(parseMeasureReport(JSON.parse(readFileSync(measureReportFile(snapshotFile), 'utf8')))).toMatchObject({ applied: [file], missing: [] });
    });

    it('streams what the build prints, line by line', async () => {
        const lines: string[] = [];

        await run(`${NODE} -e "console.log('first'); console.error('second')"`, { onOutput: line => lines.push(line) });

        expect(lines.sort()).toEqual(['first', 'second']);
    });

    it('passes the measurement request to the build in its environment', async () => {
        const lines: string[] = [];

        await run(`${NODE} -e "console.log(process.env.${MEASURE_ENV})"`, { env: { [MEASURE_ENV]: '/tmp/request.json' }, onOutput: line => lines.push(line) });

        expect(lines).toEqual(['/tmp/request.json']);
    });

    it('reports the exit code of a build that fails', async () => {
        expect(await run(`${NODE} -e "process.exit(3)"`)).toEqual({ status: 'failed', detail: 'exit code 3' });
    });

    it.skipIf(process.platform === 'win32')('stops a build that takes too long, together with the processes it started', async () => {
        const directory = temporaryDirectory();
        const pidFile = path.join(directory, 'child.pid');
        const script = [
            "const { spawn } = require('child_process');",
            "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
            `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
            'setInterval(() => {}, 1000);',
        ].join('\n');
        writeFileSync(path.join(directory, 'hang.cjs'), script);

        const outcome = await runBuild({ command: `${NODE} hang.cjs`, cwd: directory, env: {}, timeoutMs: 1_000 });

        expect(outcome).toEqual({ status: 'timed-out' });
        const child = Number(readFileSync(pidFile, 'utf8'));
        await expect.poll(() => isAlive(child), { timeout: 5_000 }).toBe(false);
    });

    it('stops a build when the measurement is cancelled', async () => {
        const abort = new AbortController();
        setTimeout(() => abort.abort(), 300);

        expect(await run(`${NODE} -e "setInterval(() => {}, 1000)"`, { signal: abort.signal })).toEqual({ status: 'cancelled' });
    });
});
