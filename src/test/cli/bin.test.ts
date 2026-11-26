import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asciiOnly } from './support';
import { normalizeEsbuildMetafile } from '../../core/adapters/esbuild';

import type { BudgetCheckReport, ComparisonReport, SummaryReport } from '../../cli/reports/model';

interface Result {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BIN = path.join(ROOT, 'packages/cli/dist/cli.cjs');
const FIXTURE = path.join(ROOT, 'src/test/fixtures/projects/esbuild-node');

let directory = '';
let current = '';
let baseline = '';
let outputBytes = 0;

function cli(args: readonly string[]): Promise<Result> {
    return new Promise((resolve) => {
        execFile(process.execPath, [BIN, ...args], { cwd: FIXTURE, encoding: 'utf8' }, (error, stdout, stderr) => {
            const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
            resolve({ code, stdout, stderr });
        });
    });
}

async function buildFixture(options: esbuild.BuildOptions): Promise<esbuild.Metafile> {
    const result = await esbuild.build({
        absWorkingDir: FIXTURE,
        entryPoints: ['src/extension.ts'],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['vscode'],
        metafile: true,
        write: false,
        outfile: 'dist/extension.js',
        logLevel: 'silent',
        ...options,
    });
    if (!result.metafile) {
        throw new Error('esbuild wrote no metafile');
    }
    return result.metafile;
}

function write(relative: string, content: unknown): string {
    const file = path.join(directory, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
}

beforeAll(async () => {
    if (!existsSync(BIN)) {
        throw new Error(`${BIN} is not built. Run npm run bundle:packages first, as npm test does.`);
    }
    directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-cli-'));
    const minified = await buildFixture({ minify: true });
    outputBytes = Object.values(minified.outputs).reduce((sum, output) => sum + output.bytes, 0);
    current = write('.true-import-cost/extension-host.json', minified);
    const snapshotFile = path.join(directory, 'main', 'extension-host.json');
    baseline = write('main/extension-host.json', normalizeEsbuildMetafile(await buildFixture({ minify: false }), {
        target: 'extension-host',
        createdAt: 1_700_000_000_000,
        root: path.relative(path.dirname(snapshotFile), FIXTURE),
        bundler: { name: 'esbuild', version: esbuild.version },
        mode: 'development',
    }));
});

afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
});

describe('the built true-import-cost command, run by node', () => {
    it('prints its own version', async () => {
        const manifest = JSON.parse(readFileSync(path.join(ROOT, 'packages/cli/package.json'), 'utf8')) as { version: string };

        expect(await cli(['--version'])).toEqual({ code: 0, stdout: `${manifest.version}\n`, stderr: '' });
    });

    it('summarises a real esbuild metafile, with package versions from the project\'s node_modules', async () => {
        const result = await cli(['summary', current, '--format', 'json']);
        const report = JSON.parse(result.stdout) as SummaryReport;

        expect(result.code).toBe(0);
        expect(report.build).toEqual({ target: 'extension-host', bundler: { name: 'esbuild' }, estimated: false });
        expect(report.totals.javascript).toBe(outputBytes);
        expect(report.packages.find(item => item.name === 'big-library')?.versions).toEqual(['3.2.0']);
        expect(report.duplicates.map(duplicate => [duplicate.name, duplicate.instances.length])).toEqual([['dup-lib', 2]]);
    });

    it('prints plain ASCII text', async () => {
        const result = await cli(['summary', current]);

        expect(result.code).toBe(0);
        expect(asciiOnly(result.stdout)).toBe(true);
        expect(result.stdout).toContain(' big-library 3.2.0\n');
    });

    it('compares a snapshot of an earlier build with the current metafile', async () => {
        const markdown = await cli(['compare', baseline, current, '--format', 'markdown']);
        const report = JSON.parse((await cli(['compare', baseline, current, '--format', 'json'])).stdout) as ComparisonReport;

        expect(markdown.code).toBe(0);
        expect(markdown.stdout).toMatch(/^### Bundle size of `extension-host`: -\d/);
        expect(markdown.stdout).toContain(`Baseline built by \`esbuild ${esbuild.version}\`, development build, current build by \`esbuild\`.`);
        expect(report.totals.javascript.after).toBe(outputBytes);
        expect(report.totals.total.delta).toBeLessThan(0);
        expect(report.packages.added + report.packages.removed).toBe(0);
        expect(report.packages.changes.find(change => change.name === 'big-library')).toMatchObject({ versionsBefore: ['3.2.0'], versionsAfter: ['3.2.0'] });
    });

    it('exits with 1 when a budget is exceeded, and with 0 when every budget is met', async () => {
        const strict = write('budgets.json', { 'extension-host': { total: 100, packages: { 'big-library': '10 B' } } });
        const settings = write('.vscode/settings.json', '{\n  // generous\n  "trueImportCost.budgets": { "*": { "total": "1 MB", }, },\n}\n');

        const exceeded = await cli(['check', current, '--budgets', strict, '--format', 'json']);
        const met = await cli(['check', current, '--budgets', settings]);

        expect(exceeded.code).toBe(1);
        expect((JSON.parse(exceeded.stdout) as BudgetCheckReport).exceeded).toBe(2);
        expect(met.code).toBe(0);
        expect(met.stdout).toContain('\nThe budget is met.\n');
    });

    it('exits with 2 and one line on stderr when it cannot read a file', async () => {
        const missing = await cli(['summary', 'nowhere.json']);
        const tooLarge = await cli(['summary', current, '--max-size', '0.0001']);

        expect(missing).toEqual({ code: 2, stdout: '', stderr: 'true-import-cost: nowhere.json: the file does not exist\n' });
        expect(tooLarge.code).toBe(2);
        expect(tooLarge.stderr).toMatch(/^true-import-cost: .*extension-host\.json: the file is 1 MB, above the 0\.0001 MB limit; raise it with --max-size\n$/);
    });
});
