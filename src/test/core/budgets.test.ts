import { describe, expect, it } from 'vitest';

import { fixture, inPackage } from './support/snapshot';
import { budgetFor, evaluateBudgets, packageLimit, parseBudgets, parseSize } from '../../core/budgets';
import { sizeTotals } from '../../core/chunks';

describe('reading a size', () => {
    it.each([
        [1500, 1500],
        ['1500', 1500],
        ['30 kB', 30_000],
        ['30kb', 30_000],
        ['30 KB', 30_000],
        ['1.5 MB', 1_500_000],
        ['500 KiB', 512_000],
        ['2 MiB', 2_097_152],
        ['1 GB', 1_000_000_000],
        ['0 B', 0],
        [' 12 b ', 12],
    ])('reads %j as %d bytes', (value, bytes) => {
        expect(parseSize(value)).toBe(bytes);
    });

    it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY], ['ten kB'], ['10 parsecs'], ['-5 kB'], [''], [null], [{}]])('rejects %j', (value) => {
        expect(parseSize(value)).toBeUndefined();
    });
});

describe('reading the budgets setting', () => {
    it('keeps the budgets of each target and skips what it cannot read', () => {
        const budgets = parseBudgets({
            webview: { total: '1.5 MB', initial: '600 kB', import: '50 kB', packages: { 'lodash*': '30 kB', moment: 0, broken: 'lots' } },
            '*': { import: 100_000 },
            nothing: 'not an object',
            '': { total: 1 },
        });

        expect([...budgets.keys()]).toEqual(['webview', '*']);
        expect(budgets.get('webview')).toEqual({
            total: 1_500_000,
            initial: 600_000,
            import: 50_000,
            packages: new Map([['lodash*', 30_000], ['moment', 0]]),
        });
    });

    it('reads anything else as no budgets at all', () => {
        expect(parseBudgets(undefined).size).toBe(0);
        expect(parseBudgets([{ total: 1 }]).size).toBe(0);
    });

    it('applies the budgets for every target where a target has none of its own, field by field', () => {
        const budgets = parseBudgets({
            '*': { import: '100 kB', css: '50 kB', packages: { moment: 0, 'lodash*': '40 kB' } },
            webview: { import: '50 kB', packages: { 'lodash*': '30 kB' } },
        });
        const webview = budgetFor(budgets, 'webview');

        expect(webview?.import).toBe(50_000);
        expect(webview?.css).toBe(50_000);
        expect(webview?.packages).toEqual(new Map([['moment', 0], ['lodash*', 30_000]]));
        expect(budgetFor(budgets, 'extension-host')?.import).toBe(100_000);
        expect(budgetFor(new Map(), 'webview')).toBeUndefined();
    });

    it('matches package budgets by exact name before wildcards', () => {
        const budget = parseBudgets({ x: { packages: { '@scope/*': 10, '@scope/big': 20, 'lodash*': 30 } } }).get('x')!;

        expect(packageLimit(budget, '@scope/big')).toBe(20);
        expect(packageLimit(budget, '@scope/small')).toBe(10);
        expect(packageLimit(budget, 'lodash-es')).toBe(30);
        expect(packageLimit(budget, 'lodash.debounce')).toBe(30);
        expect(packageLimit(budget, 'scope')).toBeUndefined();
    });
});

describe('checking a build against its budget', () => {
    const graph = fixture()
        .module('src/main.ts', 100, { entry: true })
        .module('node_modules/lodash-es/a.js', 400, inPackage('lodash-es'))
        .module('node_modules/moment/m.js', 900, inPackage('moment'))
        .chunk({ id: 'dist/main.js', bytes: 1500, entry: true })
        .chunk({ id: 'dist/main.css', bytes: 200 })
        .graph();
    const totals = sizeTotals(graph.snapshot);

    it('checks the totals it has limits for', () => {
        const budget = parseBudgets({ t: { total: '2 kB', initial: 1500, css: 100 } }).get('t')!;

        expect(evaluateBudgets(budget, totals, graph)).toEqual([
            { kind: 'total', label: 'Total output', limit: 2000, actual: 1700, exceeded: false },
            { kind: 'initial', label: 'Initial load', limit: 1500, actual: 1500, exceeded: false },
            { kind: 'css', label: 'CSS', limit: 100, actual: 200, exceeded: true },
        ]);
    });

    it('checks each bundled package a package budget names, largest first', () => {
        const budget = parseBudgets({ t: { packages: { moment: 0, 'lodash*': 500, absent: 1 } } }).get('t')!;

        expect(evaluateBudgets(budget, totals, graph)).toEqual([
            { kind: 'package', label: 'moment', limit: 0, actual: 900, exceeded: true },
            { kind: 'package', label: 'lodash-es', limit: 500, actual: 400, exceeded: false },
        ]);
    });
});
