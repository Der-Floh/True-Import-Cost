import { describe, expect, it } from 'vitest';

import { baselineBuild, currentBuild, VITE } from './builds';
import { asciiOnly, runCli } from './support';

import type { ComparisonReport } from '../../cli/reports/model';

const FILES = {
    'main/webview.json': baselineBuild(),
    'webview.json': currentBuild(),
    'esbuild.json': baselineBuild({ ...VITE, target: 'webview-old', bundler: { name: 'esbuild', version: '0.28.2' } }),
};

async function compare(...argv: string[]): Promise<string> {
    const result = await runCli(['compare', ...argv], FILES);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    return result.stdout;
}

describe('compare', () => {
    it('prints the totals with their change, then packages, chunks and modules, largest change first', async () => {
        expect(await compare('main/webview.json', 'webview.json', '--top', '3')).toBe([
            'Comparison of webview: -3.8 kB (-26.4%) in total',
            '  Baseline  vite 8.3.8 (rolldown 1.2.19), production build',
            '  Current   vite 8.3.8 (rolldown 1.2.19), production build',
            '',
            'Sizes',
            '                 Baseline  Current   Change',
            '  Total           14.4 kB  10.6 kB  -3.8 kB  -26.4%',
            '  JavaScript      12.9 kB   8.7 kB  -4.2 kB  -32.6%',
            '  CSS                 0 B    400 B   +400 B',
            '  Other assets     1.5 kB   1.5 kB      0 B',
            '  Initial load     9.8 kB     6 kB  -3.8 kB  -38.8%',
            '  Lazily loaded    3.1 kB   3.1 kB      0 B',
            '',
            'Packages: 1 added, 1 removed, 1 changed, 2 unchanged',
            '  Baseline  Current  Change  Package',
            '      5 kB      0 B   -5 kB  moment 2.29.0 (removed)',
            '       0 B    700 B  +700 B  dayjs 1.11.0 (added)',
            '     900 B    950 B   +50 B  lodash-es 4.17.20 -> 4.17.21',
            '',
            'Chunks: 2 changed',
            '  Baseline  Current   Change  Chunk',
            '    9.8 kB   5.6 kB  -4.2 kB  assets/index-ZZ99yy88.js',
            '       0 B    400 B   +400 B  assets/index-Bb7Kk2Lm.css (added)',
            '',
            'Modules: 4 changed',
            '  Baseline  Current  Change  Module',
            '      5 kB      0 B   -5 kB  moment/moment.js',
            '       0 B    700 B  +700 B  dayjs/dayjs.js',
            '    1.2 kB   1.3 kB  +100 B  src/main.ts',
            '  ... and 1 more',
            '',
        ].join('\n'));
    });

    it('writes markdown for a pull request comment, with chunks and modules folded away', async () => {
        const markdown = await compare('main/webview.json', 'webview.json', '--format', 'markdown', '--top', '2');

        expect(markdown.startsWith('### Bundle size of `webview`: -3.8 kB (-26.4%)\n\n|  | Baseline | Current | Change |\n')).toBe(true);
        expect(markdown).toContain('| Total | 14.4 kB | 10.6 kB | -3.8 kB (-26.4%) |\n');
        expect(markdown).toContain('#### Packages: 1 added, 1 removed, 1 changed, 2 unchanged\n\n| Package | Baseline | Current | Change |\n');
        expect(markdown).toContain('| `moment` `2.29.0` (removed) | 5 kB | 0 B | -5 kB |\n| `dayjs` `1.11.0` (added) | 0 B | 700 B | +700 B |\n\n... and 1 more\n');
        expect(markdown).toContain('<details>\n<summary>Chunks: 2 changed</summary>\n\n| Chunk | Baseline | Current | Change |\n');
        expect(markdown).toContain('<summary>Modules: 4 changed</summary>');
        expect(markdown.endsWith('</details>\n')).toBe(true);
        expect(asciiOnly(markdown)).toBe(true);
    });

    it('names both builds when their targets or bundlers differ', async () => {
        expect(await compare('esbuild.json', 'webview.json')).toContain('Comparison of webview with webview-old: -3.8 kB (-26.4%) in total\n  Baseline  esbuild 0.28.2, production build\n');
        expect(await compare('esbuild.json', 'webview.json', '--format', 'markdown')).toContain([
            '### Bundle size of `webview` compared with `webview-old`: -3.8 kB (-26.4%)',
            '',
            'Baseline built by `esbuild 0.28.2`, production build, current build by `vite 8.3.8 (rolldown 1.2.19)`, production build.',
        ].join('\n'));
    });

    it('says when nothing changed', async () => {
        const text = await compare('webview.json', 'webview.json');
        const markdown = await compare('webview.json', 'webview.json', '--format', 'markdown');

        expect(text).toContain('Comparison of webview: no change in total\n');
        expect(text).toContain('\nPackages: 4 unchanged\n\nChunks: no changes\n\nModules: no changes\n');
        expect(markdown).toContain('### Bundle size of `webview`: no change\n');
        expect(markdown).not.toContain('<details>');
    });

    it('writes the documented JSON, with exact byte counts', async () => {
        const report = JSON.parse(await compare('main/webview.json', 'webview.json', '--format', 'json', '--top', '1')) as ComparisonReport;

        expect(report.format).toBe('true-import-cost/comparison');
        expect(report.schemaVersion).toBe(1);
        expect(report.baseline).toEqual({ target: 'webview', bundler: VITE.bundler, mode: 'production', estimated: false });
        expect(report.totals.total).toEqual({ before: 14_400, after: 10_600, delta: -3800 });
        expect(report.totals.css).toEqual({ before: 0, after: 400, delta: 400 });
        expect(report.packages).toEqual({
            added: 1,
            removed: 1,
            changed: 1,
            unchanged: 2,
            changes: [{ name: 'moment', status: 'removed', before: 5000, after: 0, delta: -5000, versionsBefore: ['2.29.0'], versionsAfter: [] }],
        });
        expect(report.chunks).toEqual({
            changed: 2,
            changes: [{ before: 'assets/index-AB12cd34.js', after: 'assets/index-ZZ99yy88.js', bytesBefore: 9800, bytesAfter: 5600, delta: -4200 }],
        });
        expect(report.modules).toEqual({
            changed: 4,
            changes: [{ id: 'node_modules/moment/moment.js', label: 'moment/moment.js', before: 5000, after: 0, delta: -5000 }],
        });
    });
});
