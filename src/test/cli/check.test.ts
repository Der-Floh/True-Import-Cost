import { describe, expect, it } from 'vitest';

import { currentBuild, estimatedBuild } from './builds';
import { runCli } from './support';

import type { MemoryFiles } from './support';
import type { BudgetCheckReport } from '../../cli/reports/model';

const BUDGETS = {
    webview: { total: '10 kB', initial: '600 kB', css: 500, packages: { vue: '1.5 kB', 'lodash*': '1 kB', moment: 0 } },
    '*': { javascript: '1 MB', import: '100 kB' },
};

const SETTINGS = `{
    // Workspace settings, as VS Code writes them
    "editor.tabSize": 4,
    "trueImportCost.budgets": {
        "webview": { "total": "20 kB", }, /* generous */
    },
}`;

function check(argv: readonly string[], files: MemoryFiles = {}) {
    return runCli(['check', 'webview.json', ...argv], { 'webview.json': currentBuild(), 'budgets.json': JSON.stringify(BUDGETS), ...files });
}

describe('check', () => {
    it('prints every budget of the target and of "*", and exits with 1 when one is exceeded', async () => {
        const result = await check(['--budgets', 'budgets.json']);

        expect(result.code).toBe(1);
        expect(result.stderr).toBe('');
        expect(result.stdout).toBe([
            'Size budgets of webview: vite 8.3.8 (rolldown 1.2.19), production build',
            '',
            '  Status       Size   Limit       Margin  Budget',
            '  exceeded  10.6 kB   10 kB   600 B over  Total output',
            '  ok           6 kB  600 kB  594 kB left  Initial load',
            '  ok         8.7 kB    1 MB  991 kB left  JavaScript',
            '  ok          400 B   500 B   100 B left  CSS',
            '  exceeded     2 kB  1.5 kB   500 B over  Package vue',
            '  ok          950 B    1 kB    50 B left  Package lodash-es',
            '  ok            0 B     0 B  not bundled  Package moment',
            '',
            '2 of 7 budgets exceeded.',
            '',
        ].join('\n'));
    });

    it('exits with 0 when every budget is met', async () => {
        const result = await check(['--budgets', 'budgets.json'], { 'budgets.json': JSON.stringify({ webview: { total: '1 MB' } }) });

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('  ok      10.6 kB   1 MB  989 kB left  Total output\n\nThe budget is met.\n');
    });

    it('reads the budgets from a VS Code settings.json with comments and trailing commas', async () => {
        const result = await check(['--budgets', '.vscode/settings.json'], { '.vscode/settings.json': SETTINGS });

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Total output');
    });

    it('applies the budgets of the target named with --target', async () => {
        const files = { 'budgets.json': JSON.stringify({ webview: { total: '1 MB' }, 'web-app': { css: 100 } }) };
        const result = await check(['--budgets', 'budgets.json', '--target', 'web-app'], files);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain('Size budgets of web-app: ');
        expect(result.stdout).toContain('  exceeded  400 B  100 B  300 B over  CSS\n');
    });

    it('writes markdown and the documented JSON', async () => {
        const markdown = (await check(['--budgets', 'budgets.json', '--format', 'markdown'])).stdout;
        const json = JSON.parse((await check(['--budgets', 'budgets.json', '--format', 'json'])).stdout) as BudgetCheckReport;

        expect(markdown).toContain('### Size budgets of `webview`: 2 of 7 budgets exceeded\n');
        expect(markdown).toContain('| Total output | 10.6 kB | 10 kB | **Exceeded** by 600 B |\n');
        expect(markdown).toContain('| Package `moment` | 0 B | 0 B | Not bundled |\n');
        expect(json).toMatchObject({ format: 'true-import-cost/budget-check', schemaVersion: 1, target: 'webview', passed: false, exceeded: 2 });
        expect(json.build.target).toBe('webview');
        expect(json.results[0]).toEqual({ kind: 'total', label: 'Total output', limit: 10_000, actual: 10_600, exceeded: true });
        expect(json.results.at(-1)).toEqual({ kind: 'package', label: 'moment', limit: 0, actual: 0, exceeded: false });
    });

    it('marks package sizes of an estimated build with ~', async () => {
        const result = await check(['--budgets', 'budgets.json'], { 'webview.json': estimatedBuild() });

        expect(result.stdout).toContain('  exceeded  ~2 kB  1.5 kB  ~500 B over  Package vue\n');
        expect(result.stdout).toContain('\n~ marks an estimate rather than a size the bundler reported.\n');
    });

    it.each([
        [{ 'budgets.json': JSON.stringify({ other: { total: 1 } }) }, [], 'true-import-cost: budgets.json has no budget for "webview" and none for "*"; name the target whose budgets apply with --target'],
        [{ 'budgets.json': JSON.stringify({ other: { total: 1 } }) }, ['--target', 'web'], 'true-import-cost: budgets.json has no budget for "web" and none for "*"'],
        [
            { 'budgets.json': JSON.stringify({ '*': { import: '100 kB' } }) },
            [],
            'true-import-cost: the budget of "webview" in budgets.json sets no total, initial, javascript, css or packages limit; an import limit is checked in the editor, per import',
        ],
        [{ 'budgets.json': JSON.stringify({ webview: { totl: '1 MB' } }) }, [], 'true-import-cost: budgets.json: the budget of "webview" has an unknown field "totl"; the fields are total, initial, javascript, css, import, packages'],
        [{ 'budgets.json': JSON.stringify({ webview: { total: '1 MBB' } }) }, [], 'true-import-cost: budgets.json: "webview".total is not a size such as 30000, "30 kB" or "1.5 MB": "1 MBB"'],
        [{ 'budgets.json': JSON.stringify({ webview: { packages: { vue: 'small' } } }) }, [], 'true-import-cost: budgets.json: "webview".packages["vue"] is not a size such as 30000, "30 kB" or "1.5 MB": "small"'],
        [{ 'budgets.json': JSON.stringify({ webview: { packages: ['vue'] } }) }, [], 'true-import-cost: budgets.json: "webview".packages is not an object of package names and sizes'],
        [{ 'budgets.json': JSON.stringify({ webview: '1 MB' }) }, [], 'true-import-cost: budgets.json: the budget of "webview" is not an object'],
        [{ 'budgets.json': '[]' }, [], 'true-import-cost: budgets.json: the budgets are not an object keyed by build target'],
        [{ 'budgets.json': '{ "webview": ' }, [], 'true-import-cost: budgets.json: the file is not valid JSON: '],
        [{}, [], 'true-import-cost: budgets.json: the file does not exist'],
        [{ '.vscode/settings.json': '{ "editor.tabSize": 4 }' }, ['--budgets', '.vscode/settings.json'], 'true-import-cost: .vscode/settings.json: there is no "trueImportCost.budgets" setting in it'],
    ])('rejects budgets it cannot apply (%#)', async (files: MemoryFiles, argv: readonly string[], message: string) => {
        const budgetsGiven = argv.includes('--budgets');
        const result = await runCli(['check', 'webview.json', ...(budgetsGiven ? [] : ['--budgets', 'budgets.json']), ...argv], { 'webview.json': currentBuild(), ...files });

        expect(result.code).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr.startsWith(message)).toBe(true);
        expect(result.stderr.split('\n')).toHaveLength(2);
    });
});
