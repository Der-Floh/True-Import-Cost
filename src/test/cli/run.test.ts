import { describe, expect, it } from 'vitest';

import { currentBuild } from './builds';
import { asciiOnly, memoryEnvironment, runCli, VERSION } from './support';
import { run } from '../../cli/run';
import { USAGE } from '../../cli/usage';
import { fixture, inPackage } from '../core/support/snapshot';

import type { SummaryReport } from '../../cli/reports/model';

const HOSTILE_NAME = '\u001b[2J\n::error::forged‮';

const HOSTILE = JSON.stringify({
    ...fixture()
        .module('src/main.ts', 100, { entry: true })
        .module(`node_modules/${HOSTILE_NAME}/index.js`, 50, inPackage(HOSTILE_NAME, '1.0.0\r\n::warning::x', 'node_modules/evil'))
        .snapshot(),
    target: 'web\u0007app',
});

function startsAnyLineWith(text: string, prefix: string): boolean {
    return text.split('\n').some(line => line.trimStart().startsWith(prefix));
}

describe('the command line', () => {
    it('prints its usage on --help, in ASCII', async () => {
        const result = await runCli(['--help']);

        expect(result).toEqual({ code: 0, stdout: USAGE, stderr: '' });
        expect(asciiOnly(USAGE)).toBe(true);
    });

    it('prints its version on --version', async () => {
        expect(await runCli(['--version'])).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
    });

    it.each([
        [[], 'true-import-cost: no command given (see true-import-cost --help)\n'],
        [['summary', 'meta.json', '--format', 'yaml'], 'true-import-cost: --format must be text, markdown or json, not "yaml" (see true-import-cost --help)\n'],
        [['summary', 'missing.json'], 'true-import-cost: missing.json: the file does not exist\n'],
        [['compare', 'missing.json', 'web.json'], 'true-import-cost: missing.json: the file does not exist\n'],
    ])('exits with 2 and one line on stderr for %j', async (argv, stderr) => {
        expect(await runCli(argv, { 'web.json': currentBuild() })).toEqual({ code: 2, stdout: '', stderr });
    });

    it('flattens a validation error into one ASCII line', async () => {
        const invalid = JSON.stringify({ ...fixture().module('src/main.ts', 1).snapshot(), modules: [{ id: 7, path: 'x', contributions: [] }] });
        const result = await runCli(['summary', 'bad.json'], { 'bad.json': invalid });

        expect(result.code).toBe(2);
        expect(result.stderr.startsWith('true-import-cost: bad.json: ')).toBe(true);
        expect(result.stderr.indexOf('\n')).toBe(result.stderr.length - 1);
        expect(asciiOnly(result.stderr)).toBe(true);
    });

    it('reports a failure it did not expect as such, with exit code 2', async () => {
        const output = { stdout: [] as string[], stderr: [] as string[] };
        const environment = memoryEnvironment({}, output);
        const broken = { ...environment, files: { ...environment.files, info: () => Promise.reject(new Error('disk on fire')) } };

        expect(await run(['summary', 'web.json'], broken)).toBe(2);
        expect(output.stderr.join('')).toBe('true-import-cost: unexpected error: disk on fire\n');
    });

    it('escapes control and invisible characters from the metadata, so it cannot forge lines in a CI log', async () => {
        const files = { 'hostile.json': HOSTILE };
        const text = (await runCli(['summary', 'hostile.json'], files)).stdout;
        const markdown = (await runCli(['summary', 'hostile.json', '--format', 'markdown'], files)).stdout;
        const json = (await runCli(['summary', 'hostile.json', '--format', 'json'], files)).stdout;

        for (const output of [text, markdown, json]) {
            expect(asciiOnly(output)).toBe(true);
            expect(startsAnyLineWith(output, '::')).toBe(false);
        }
        expect(text).toContain('Bundle summary of web\\u0007app: fixture\n');
        expect(text).toContain('\\u001b[2J\\u000a::error::forged\\u202e 1.0.0\\u000d\\u000a::warning::x');
        expect((JSON.parse(json) as SummaryReport).packages[0]?.name).toBe(HOSTILE_NAME);
    });
});
