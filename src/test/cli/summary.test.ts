import { describe, expect, it } from 'vitest';

import { currentBuild, estimatedBuild } from './builds';
import { asciiOnly, runCli } from './support';
import { fixture } from '../core/support/snapshot';

import type { SummaryReport } from '../../cli/reports/model';

const FILES = { 'web.json': currentBuild(), 'estimated.json': estimatedBuild() };

async function summary(...argv: string[]): Promise<string> {
    const result = await runCli(['summary', ...argv], FILES);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    return result.stdout;
}

describe('summary', () => {
    it('prints the sizes, the largest packages with their versions, and the duplicates as plain text', async () => {
        expect(await summary('web.json', '--top', '3')).toBe([
            'Bundle summary of webview: vite 8.3.8 (rolldown 1.2.19), production build',
            '',
            'Sizes',
            '  Total          10.6 kB',
            '  JavaScript      8.7 kB',
            '  CSS              400 B',
            '  Other assets    1.5 kB',
            '  Initial load      6 kB',
            '  Lazily loaded   3.1 kB',
            '',
            'Largest packages: 3 of 4',
            '   Size  Lazy  Package',
            '   2 kB   0 B  vue 3.5.0',
            '  950 B   0 B  lodash-es 4.17.21',
            '  700 B   0 B  dayjs 1.11.0',
            '',
            'Duplicate packages: 1',
            '   Size  Package',
            '  300 B  dup 1.0.0 in node_modules/dup',
            '  200 B  dup 2.0.0 in node_modules/wrap/node_modules/dup',
            '',
        ].join('\n'));
    });

    it('writes markdown tables', async () => {
        const markdown = await summary('web.json', '--format', 'markdown', '--top', '1');

        expect(markdown).toContain('### Bundle summary of `webview`\n\nBuilt by `vite 8.3.8 (rolldown 1.2.19)`, production build.\n');
        expect(markdown).toContain('| Total | 10.6 kB |\n');
        expect(markdown).toContain('#### Largest packages: 1 of 4\n\n| Package | Versions | Size | Lazily loaded |\n| --- | --- | ---: | ---: |\n| `vue` | `3.5.0` | 2 kB | 0 B |\n');
        expect(markdown).toContain('| `dup` | `2.0.0` | `node_modules/wrap/node_modules/dup` | 200 B |');
    });

    it('writes the documented JSON, with exact byte counts and every list cut to --top', async () => {
        const report = JSON.parse(await summary('web.json', '--format', 'json', '--top', '2')) as SummaryReport;

        expect(report).toEqual({
            format: 'true-import-cost/summary',
            schemaVersion: 1,
            build: { target: 'webview', bundler: { name: 'vite', version: '8.3.8', engine: 'rolldown 1.2.19' }, mode: 'production', estimated: false },
            totals: { total: 10_600, javascript: 8700, css: 400, assets: 1500, initial: 6000, lazy: 3100 },
            packageCount: 4,
            packages: [
                { name: 'vue', versions: ['3.5.0'], bytes: 2000, lazyBytes: 0, modules: 1, duplicate: false },
                { name: 'lodash-es', versions: ['4.17.21'], bytes: 950, lazyBytes: 0, modules: 1, duplicate: false },
            ],
            duplicates: [{
                name: 'dup',
                bytes: 500,
                instances: [
                    { version: '1.0.0', root: 'node_modules/dup', bytes: 300 },
                    { version: '2.0.0', root: 'node_modules/wrap/node_modules/dup', bytes: 200 },
                ],
            }],
        });
    });

    it('marks estimated sizes with ~ and says what it means', async () => {
        const text = await summary('estimated.json');

        expect(text).toContain('  ~2 kB   0 B  vue 3.5.0\n');
        expect(text).toContain('\n~ marks an estimate rather than a size the bundler reported.\n');
        expect(JSON.parse(await summary('estimated.json', '--format', 'json'))).toMatchObject({ build: { estimated: true } });
    });

    it('says so when nothing from a package is bundled', async () => {
        const result = await runCli(['summary', 'app.json'], { 'app.json': JSON.stringify(fixture().module('src/main.ts', 10, { entry: true }).snapshot()) });

        expect(result.stdout).toContain('\nPackages: none bundled\n\nDuplicate packages: none\n');
    });

    it('prints the same output for the same input, in ASCII', async () => {
        const first = await summary('web.json');

        expect(await summary('web.json')).toBe(first);
        expect(asciiOnly(first)).toBe(true);
        expect(asciiOnly(await summary('web.json', '--format', 'markdown'))).toBe(true);
    });
});
