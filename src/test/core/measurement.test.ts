import { describe, expect, it } from 'vitest';

import { fixture, inPackage } from './support/snapshot';
import { importChanges, measureComparedBuilds, measureImport, parseMeasurement, savingsOf, singleImportChange } from '../../core/measurement';

import type { BuildGraph } from '../../core/graph/buildGraph';

interface AppOptions {
    readonly dayjs?: boolean;
    readonly mainBytes?: number;
    readonly lodashVersion?: string;
    readonly extraImport?: boolean;
}

function app(options: AppOptions = {}): BuildGraph {
    const build = fixture()
        .module('src/main.ts', options.mainBytes ?? 100, { entry: true })
        .module('src/helper.ts', 50)
        .module('node_modules/lodash-es/debounce.js', 900, inPackage('lodash-es', options.lodashVersion ?? '4.17.21'))
        .imports('src/main.ts', 'src/helper.ts', { specifier: './helper' })
        .imports('src/main.ts', 'node_modules/lodash-es/debounce.js', { specifier: 'lodash-es' });
    if (options.dayjs ?? true) {
        build.module('node_modules/dayjs/dayjs.js', 700, inPackage('dayjs', '1.11.0')).imports('src/helper.ts', 'node_modules/dayjs/dayjs.js', { specifier: 'dayjs' });
    }
    if (options.extraImport === true) {
        build.module('src/extra.ts', 10).imports('src/main.ts', 'src/extra.ts', { specifier: './extra' });
    }
    return build.graph();
}

const SUBJECT = { method: 'built-without', importer: 'src/helper.ts', specifier: 'dayjs', measuredAt: 1_000 } as const;

describe('measuring an import from a build with it and a build without it', () => {
    it('records both builds\' totals, the packages that shrank and how many modules did', () => {
        const measurement = measureImport(app(), app({ dayjs: false }), SUBJECT);

        expect(savingsOf(measurement)).toEqual({ total: 700, javascript: 700, css: 0, assets: 0, initial: 700, lazy: 0 });
        expect(measurement.packages).toEqual([{ name: 'dayjs', bytes: 700 }]);
        expect(measurement.modules).toBe(1);
        expect(measurement).toMatchObject(SUBJECT);
    });
});

describe('two builds that differ by one import', () => {
    it('finds the first-party imports one build has and the other does not', () => {
        expect(importChanges(app(), app({ dayjs: false }))).toEqual([{ kind: 'removed', importer: 'src/helper.ts', specifier: 'dayjs' }]);
        expect(importChanges(app({ dayjs: false }), app())).toEqual([{ kind: 'added', importer: 'src/helper.ts', specifier: 'dayjs' }]);
    });

    it('takes a single changed import as the measurement of that import', () => {
        const change = singleImportChange(app(), app({ dayjs: false }));

        expect(change).toEqual({ kind: 'removed', importer: 'src/helper.ts', specifier: 'dayjs' });
    });

    it.each([
        ['another import changed as well', app({ dayjs: false, extraImport: true })],
        ['other code changed as well', app({ dayjs: false, mainBytes: 2_000 })],
        ['a package version changed as well', app({ dayjs: false, lodashVersion: '4.17.22' })],
    ])('measures nothing when %s', (_reason, current) => {
        expect(singleImportChange(app(), current)).toBeUndefined();
    });

    it('measures a removed import from the baseline and an added one from the current build', () => {
        const removed = measureComparedBuilds(app(), app({ dayjs: false }), { kind: 'removed', importer: 'src/helper.ts', specifier: 'dayjs' }, 5);
        const added = measureComparedBuilds(app({ dayjs: false }), app(), { kind: 'added', importer: 'src/helper.ts', specifier: 'dayjs' }, 5);

        expect(savingsOf(removed).total).toBe(700);
        expect(savingsOf(added).total).toBe(700);
        expect(removed).toMatchObject({ method: 'compared-builds', measuredAt: 5 });
    });
});

describe('a stored measurement', () => {
    it('reads back what was written', () => {
        const measurement = measureImport(app(), app({ dayjs: false }), SUBJECT);

        expect(parseMeasurement(JSON.parse(JSON.stringify(measurement)))).toEqual(measurement);
    });

    it.each([
        ['no method', { ...measureImport(app(), app({ dayjs: false }), SUBJECT), method: 'guessed' }],
        ['negative totals', { ...measureImport(app(), app({ dayjs: false }), SUBJECT), withImport: { total: -1 } }],
        ['no importer', { ...measureImport(app(), app({ dayjs: false }), SUBJECT), importer: '' }],
        ['not an object', 'measured'],
    ])('is ignored with %s', (_reason, value) => {
        expect(parseMeasurement(value)).toBeUndefined();
    });
});
