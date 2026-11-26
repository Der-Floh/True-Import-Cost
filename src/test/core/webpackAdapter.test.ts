import { describe, expect, it } from 'vitest';

import { BUILD_CONTEXT } from './support/esbuild';
import { chunkIn, edgesFrom, moduleIn } from './support/snapshot';
import { encodeMappings } from './support/vlq';
import {
    at,
    concatenated,
    CONTEXT,
    entryReason,
    externalModule,
    reason,
    runtimeModule,
    stats,
    statsAsset,
    statsChunk,
    statsModule,
} from './support/webpack';
import { normalizeMetadata } from '../../core/adapters/registry';
import { isWebpackStats, normalizeWebpackStats, webpackAdapter } from '../../core/adapters/webpack';
import { parseSnapshot } from '../../core/schema/validate';

import type { StatsModuleJson } from './support/webpack';
import type { WebpackBuildDetails } from '../../core/adapters/webpack';
import type { BuildSnapshot, ModuleContribution } from '../../core/schema/snapshot';

const INDEX = statsModule('src/index.js', { size: 400 });
const UTIL = statsModule('src/util.js', { size: 200, reasons: [reason('harmony side effect evaluation', 'src/index.js', './util'), reason('harmony import specifier', 'src/index.js', './util')] });
const BARREL = statsModule('node_modules/lib/index.js', { size: 60, reasons: [reason('harmony side effect evaluation', 'src/index.js', 'lib')] });
const DEFINER = statsModule('node_modules/lib/a.js', {
    size: 300,
    reasons: [
        reason('harmony side effect evaluation', 'node_modules/lib/index.js', './a.js'),
        reason('harmony export imported specifier', 'node_modules/lib/index.js', './a.js'),
        reason('harmony import specifier', 'src/index.js', 'lib'),
    ],
});
const VSCODE = externalModule('vscode', { reasons: [reason('harmony side effect evaluation', 'src/index.js', 'vscode')] });
const MAIN = concatenated(INDEX, [UTIL, DEFINER, VSCODE], { chunks: [1], reasons: [entryReason('./src/index.js')] });
const FS = externalModule('fs', { reasons: [reason('cjs require', 'src/util.js', 'fs')] });
const CJS = statsModule('node_modules/cjs/index.js', { size: 100, chunks: [1], reasons: [reason('cjs require', 'src/util.js', 'cjs'), reason('cjs self exports reference', 'node_modules/cjs/index.js')] });
const LAZY = statsModule('src/lazy.js', {
    size: 150,
    chunks: [2],
    reasons: [{ type: 'import()', moduleIdentifier: MAIN.identifier, resolvedModuleIdentifier: null, userRequest: './lazy' }],
});
const STYLE = statsModule('src/style.css', { name: 'css ./src/style.css', moduleType: 'css/auto', size: 1, sizes: { css: 80 }, chunks: [1], reasons: [reason('harmony side effect evaluation', 'src/index.js', './style.css')] });
const LOGO = statsModule('src/logo.png', { moduleType: 'asset/resource', size: 42, sizes: { javascript: 42, asset: 1000 }, chunks: [1], reasons: [reason('harmony side effect evaluation', 'src/index.js', './logo.png')] });

const APP = stats({
    modules: [INDEX, MAIN, FS, CJS, LAZY, STYLE, LOGO, BARREL, UTIL, DEFINER, VSCODE, runtimeModule('ensure chunk', 300, [1])],
    chunks: [
        statsChunk(1, ['main.js', 'main.css'], { initial: true, children: [2], auxiliaryFiles: ['logo.abc.png', 'main.js.map'] }),
        statsChunk(2, ['2.js']),
    ],
    assets: [
        statsAsset('main.js', 600, { minimized: true }, [statsAsset('main.js.map', 3000)]),
        statsAsset('main.css', 40),
        statsAsset('2.js', 90),
        statsAsset('logo.abc.png', 1000, { sourceFilename: 'src/logo.png' }),
    ],
});

function contributionsOf(snapshot: BuildSnapshot, id: string): readonly ModuleContribution[] {
    return moduleIn(snapshot, id).contributions;
}

function oneChunk(modules: readonly StatsModuleJson[], bytes: number, details?: WebpackBuildDetails): BuildSnapshot {
    return normalizeWebpackStats(stats({
        modules,
        chunks: [statsChunk('main', ['main.js'], { initial: true })],
        assets: [statsAsset('main.js', bytes)],
    }), BUILD_CONTEXT, details);
}

describe('normalizeWebpackStats', () => {
    const snapshot = normalizeWebpackStats(APP, BUILD_CONTEXT);

    it('turns every module into a module named by its path relative to the context, including those inside a concatenated module', () => {
        expect(snapshot.modules.map(module => module.id).sort()).toEqual([
            'node_modules/cjs/index.js',
            'node_modules/lib/a.js',
            'node_modules/lib/index.js',
            'src/index.js',
            'src/lazy.js',
            'src/logo.png',
            'src/style.css',
            'src/util.js',
            'webpack/runtime/ensure chunk',
        ]);
        expect(moduleIn(snapshot, 'node_modules/lib/a.js')).toMatchObject({ path: 'node_modules/lib/a.js', packageName: 'lib', packageRoot: 'node_modules/lib', sourceBytes: 300 });
    });

    it('flags runtime modules as virtual and marks the root of the concatenated entry module as the entry', () => {
        expect(moduleIn(snapshot, 'webpack/runtime/ensure chunk').virtual).toBe(true);
        expect(snapshot.modules.filter(module => module.entry).map(module => module.id)).toEqual(['src/index.js']);
    });

    it('records imports with the specifier as written, from the module inside the concatenated module that has them', () => {
        expect(edgesFrom(snapshot, 'src/index.js').filter(edge => !edge.external)).toEqual(expect.arrayContaining([
            { importer: 'src/index.js', specifier: './util', resolvedModule: 'src/util.js', kind: 'static', external: false },
            { importer: 'src/index.js', specifier: './lazy', resolvedModule: 'src/lazy.js', kind: 'dynamic', external: false },
            { importer: 'src/index.js', specifier: './style.css', resolvedModule: 'src/style.css', kind: 'static', external: false },
        ]));
        expect(edgesFrom(snapshot, 'src/util.js').filter(edge => !edge.external)).toEqual([
            { importer: 'src/util.js', specifier: 'cjs', resolvedModule: 'node_modules/cjs/index.js', kind: 'require', external: false },
        ]);
    });

    it('keeps an import of a barrel on the barrel, not on the module the bundler skipped to', () => {
        expect(edgesFrom(snapshot, 'src/index.js').filter(edge => edge.specifier === 'lib')).toEqual([
            { importer: 'src/index.js', specifier: 'lib', resolvedModule: 'node_modules/lib/index.js', kind: 'static', external: false },
        ]);
        expect(edgesFrom(snapshot, 'node_modules/lib/index.js')).toEqual([
            { importer: 'node_modules/lib/index.js', specifier: './a.js', resolvedModule: 'node_modules/lib/a.js', kind: 'static', external: false },
        ]);
    });

    it('records no edge for a module referring to itself', () => {
        expect(edgesFrom(snapshot, 'node_modules/cjs/index.js')).toEqual([]);
    });

    it('records externals as external imports, retained when the output still contains them', () => {
        expect(edgesFrom(snapshot, 'src/index.js').find(edge => edge.external)).toEqual({ importer: 'src/index.js', specifier: 'vscode', kind: 'static', external: true, retained: true });
        expect(edgesFrom(snapshot, 'src/util.js').find(edge => edge.external)).toEqual({ importer: 'src/util.js', specifier: 'fs', kind: 'require', external: true, retained: false });
    });

    it('scales module sizes down to the minified file, across the modules of the chunk', () => {
        const scripts = snapshot.modules.flatMap(module => module.contributions).filter(contribution => contribution.chunkId === 'main.js');

        expect(contributionsOf(snapshot, 'src/index.js')).toEqual([{ chunkId: 'main.js', bytes: Math.round(400 * 600 / 1342), precision: 'proportional-estimate' }]);
        expect(contributionsOf(snapshot, 'webpack/runtime/ensure chunk')).toEqual([{ chunkId: 'main.js', bytes: Math.round(300 * 600 / 1342), precision: 'proportional-estimate' }]);
        expect(Math.abs(scripts.reduce((sum, contribution) => sum + contribution.bytes, 0) - 600)).toBeLessThanOrEqual(scripts.length);
        expect(contributionsOf(snapshot, 'src/lazy.js')).toEqual([{ chunkId: '2.js', bytes: 90, precision: 'proportional-estimate' }]);
    });

    it('splits a CSS file across the CSS of the chunk\'s modules, and credits an emitted asset to its module', () => {
        expect(contributionsOf(snapshot, 'src/style.css')).toEqual([{ chunkId: 'main.css', bytes: 40, precision: 'proportional-estimate' }]);
        expect(contributionsOf(snapshot, 'src/logo.png')).toEqual([
            { chunkId: 'main.js', bytes: Math.round(42 * 600 / 1342), precision: 'proportional-estimate' },
            { chunkId: 'logo.abc.png', bytes: 1000, precision: 'bundler-reported' },
        ]);
    });

    it('keeps a module that no chunk contains without contributions', () => {
        expect(contributionsOf(snapshot, 'node_modules/lib/index.js')).toEqual([]);
    });

    it('records each emitted JavaScript and CSS file as a chunk, with the files it loads', () => {
        expect(chunkIn(snapshot, 'main.js')).toEqual({
            id: 'main.js',
            kind: 'js',
            bytes: 600,
            entry: true,
            dynamicEntry: false,
            entryModule: 'src/index.js',
            imports: [],
            dynamicImports: ['2.js'],
            css: ['main.css'],
            assets: ['logo.abc.png'],
        });
        expect(chunkIn(snapshot, 'main.css')).toMatchObject({ kind: 'css', bytes: 40, entry: true, dynamicEntry: false });
        expect(chunkIn(snapshot, '2.js')).toMatchObject({ entry: false, dynamicEntry: true, entryModule: 'src/lazy.js' });
    });

    it('records the other outputs as assets of their kind, source maps included', () => {
        expect(snapshot.assets).toEqual([
            { id: 'main.js.map', kind: 'sourcemap', bytes: 3000 },
            { id: 'logo.abc.png', kind: 'image', bytes: 1000 },
        ]);
    });

    it('names the bundler and its version, and takes the rest from the context', () => {
        expect(snapshot).toMatchObject({ id: 'app@1700000000000', target: 'app', bundler: { name: 'webpack', version: '5.113.0' }, root: '.' });
        expect(normalizeWebpackStats({ ...APP, rspackVersion: '2.3.4' }, BUILD_CONTEXT).bundler).toEqual({ name: 'rspack', version: '2.3.4' });
    });

    it('produces a snapshot that passes validation', () => {
        expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual({ ok: true, snapshot });
    });
});

describe('normalizeWebpackStats module names', () => {
    it('keeps the query of a module in its id but not in its path, and ignores the loaders in front of it', () => {
        const script = statsModule('src/App.vue?vue&type=script&lang=js', { chunks: ['main'], name: './node_modules/vue-loader/dist/index.js??ruleSet[1]!./src/App.vue?vue&type=script&lang=js' });

        expect(moduleIn(oneChunk([script], 50), 'src/App.vue?vue&type=script&lang=js').path).toBe('src/App.vue');
    });

    it('gives two modules built from one file ids of their own', () => {
        const javascript = statsModule('src/style.css', { chunks: ['main'] });
        const extracted = { ...statsModule('src/style.css', { chunks: ['main'], moduleType: 'css/mini-extract' }), identifier: `css ${at('src/style.css')}`, name: 'css ./node_modules/css-loader/dist/cjs.js!./src/style.css' };

        expect(oneChunk([javascript, extracted], 50).modules.map(module => [module.id, module.path])).toEqual([
            ['src/style.css', 'src/style.css'],
            ['src/style.css|css/mini-extract', 'src/style.css'],
        ]);
    });

    it('names modules outside the context and modules with spaces in their path', () => {
        const outside = statsModule('../shared/util.js', { chunks: ['main'], name: '../shared/util.js' });
        const spaced = statsModule('src/my file.js', { chunks: ['main'] });

        expect(oneChunk([outside, spaced], 50).modules.map(module => module.id)).toEqual(['../shared/util.js', 'src/my file.js']);
    });

    it('keeps a module without a file, such as a context module, as a virtual module named after it', () => {
        const context = { ...statsModule('src/locales', { chunks: ['main'] }), name: './src/locales sync ^\\.\\/.*\\.json$', nameForCondition: null };

        expect(oneChunk([context], 50).modules[0]).toMatchObject({ id: 'src/locales sync ^\\.\\/.*\\.json$', virtual: true });
    });

    it('recognises files by their name when the stats do not say which modules have one', () => {
        const { nameForCondition: _file, ...unknown } = statsModule('src/a.js', { chunks: ['main'] });
        const snapshot = oneChunk([unknown, { ...runtimeModule('ensure chunk', 10, ['main']), nameForCondition: undefined }], 50);

        expect(snapshot.modules.map(module => [module.id, module.virtual ?? false])).toEqual([['src/a.js', false], ['webpack/runtime/ensure chunk', true]]);
    });
});

describe('normalizeWebpackStats imports', () => {
    it('falls back to the module the bundler skipped to when the barrel itself is not listed', () => {
        const snapshot = oneChunk([statsModule('src/index.js', { chunks: ['main'] }), DEFINER], 50);

        expect(edgesFrom(snapshot, 'src/index.js')).toEqual([{ importer: 'src/index.js', specifier: 'lib', resolvedModule: 'node_modules/lib/a.js', kind: 'static', external: false }]);
    });

    it('tells static, dynamic, require, CSS and reference imports apart, and ignores what is not an import', () => {
        const kinds: [string, string | undefined][] = [
            ['esm import', 'static'],
            ['dynamic import', 'dynamic'],
            ['import() eager', 'dynamic'],
            ['cjs full require', 'require'],
            ['amd require', 'require'],
            ['css @import', 'css'],
            ['css import', 'css'],
            ['require.resolve', 'reference'],
            ['new URL()', 'reference'],
            ['css url()', 'reference'],
            ['provided', 'static'],
            ['module.hot.accept', undefined],
            ['import.meta.webpackHot.accept', undefined],
            ['harmony export specifier', undefined],
        ];
        const index = statsModule('src/index.js', { chunks: ['main'] });
        const targets = kinds.map(([type], position) => statsModule(`src/target${position}.js`, { chunks: ['main'], reasons: [reason(type, 'src/index.js', `./target${position}`)] }));
        const snapshot = oneChunk([index, ...targets], 50);

        expect(kinds.map((_, position) => edgesFrom(snapshot, 'src/index.js').find(edge => edge.specifier === `./target${position}`)?.kind)).toEqual(kinds.map(([, kind]) => kind));
    });
});

describe('normalizeWebpackStats size estimates', () => {
    it('takes module sizes as they are when the file is not minified', () => {
        const snapshot = oneChunk([statsModule('src/a.js', { size: 30, chunks: ['main'] }), statsModule('src/b.js', { size: 20, chunks: ['main'] })], 500);

        expect(contributionsOf(snapshot, 'src/a.js')).toEqual([{ chunkId: 'main.js', bytes: 30, precision: 'rendered-length' }]);
        expect(contributionsOf(snapshot, 'src/b.js')).toEqual([{ chunkId: 'main.js', bytes: 20, precision: 'rendered-length' }]);
    });

    it('measures modules from the source map of the file, by webpack:// name, absolute path or runtime module, and estimates the rest from what is left', () => {
        const code = `${'a'.repeat(5)}${'r'.repeat(3)}bb`;
        const snapshot = oneChunk([
            statsModule('src/a.js', { size: 100, chunks: ['main'] }),
            runtimeModule('ensure chunk', 50, ['main']),
            statsModule('src/b.js', { size: 30, chunks: ['main'] }),
            statsModule('src/c.js', { size: 20, chunks: ['main'] }),
        ], 12, {
            baseDir: CONTEXT,
            outputs: new Map([['main.js', {
                code,
                map: {
                    sources: ['webpack://app/./src/a.js?ab12', 'webpack://app/webpack/runtime/ensure chunk', at('src/b.js')],
                    mappings: encodeMappings([[{ column: 0, source: 0 }, { column: 5, source: 1 }, { column: 8, source: 2 }]]),
                },
            }]]),
        });

        expect(contributionsOf(snapshot, 'src/a.js')).toEqual([{ chunkId: 'main.js', bytes: 5, precision: 'sourcemap-estimate' }]);
        expect(contributionsOf(snapshot, 'webpack/runtime/ensure chunk')).toEqual([{ chunkId: 'main.js', bytes: 3, precision: 'sourcemap-estimate' }]);
        expect(contributionsOf(snapshot, 'src/b.js')).toEqual([{ chunkId: 'main.js', bytes: 2, precision: 'sourcemap-estimate' }]);
        expect(contributionsOf(snapshot, 'src/c.js')).toEqual([{ chunkId: 'main.js', bytes: 2, precision: 'proportional-estimate' }]);
    });

    it('splits the mapped bytes of one file between the modules built from it', () => {
        const snapshot = oneChunk([
            statsModule('src/App.vue?vue&type=script', { size: 30, chunks: ['main'] }),
            statsModule('src/App.vue?vue&type=template', { size: 90, chunks: ['main'] }),
        ], 12, {
            outputs: new Map([['main.js', { code: 'x'.repeat(12), map: { sources: ['webpack://app/./src/App.vue'], mappings: encodeMappings([[{ column: 0, source: 0 }]]) } }]]),
        });

        expect(contributionsOf(snapshot, 'src/App.vue?vue&type=script')).toEqual([{ chunkId: 'main.js', bytes: 3, precision: 'sourcemap-estimate' }]);
        expect(contributionsOf(snapshot, 'src/App.vue?vue&type=template')).toEqual([{ chunkId: 'main.js', bytes: 9, precision: 'sourcemap-estimate' }]);
    });

    it('falls back to proportional estimates when the source map cannot be decoded', () => {
        const snapshot = oneChunk([statsModule('src/a.js', { size: 100, chunks: ['main'] })], 50, {
            outputs: new Map([['main.js', { code: 'a'.repeat(50), map: { sources: ['webpack://app/./src/a.js'], mappings: 'A*AA' } }]]),
        });

        expect(contributionsOf(snapshot, 'src/a.js')).toEqual([{ chunkId: 'main.js', bytes: 50, precision: 'proportional-estimate' }]);
    });
});

describe('normalizeWebpackStats chunk relations', () => {
    it('lists the chunks an entry chunk loads with it as imports, and lazy chunks without a lazily imported module as neither entry nor dynamic entry', () => {
        const snapshot = normalizeWebpackStats(stats({
            modules: [statsModule('src/index.js', { chunks: ['main'], reasons: [entryReason('./src/index.js')] }), statsModule('node_modules/big/index.js', { chunks: ['vendors', 'shared'] })],
            chunks: [
                statsChunk('main', ['main.js'], { initial: true, siblings: ['vendors'], children: ['shared'] }),
                statsChunk('vendors', ['vendors.js', 'vendors.css'], { initial: true, siblings: ['main'] }),
                statsChunk('shared', ['shared.js']),
            ],
            assets: [statsAsset('main.js', 10), statsAsset('vendors.js', 10), statsAsset('vendors.css', 10), statsAsset('shared.js', 10)],
        }), BUILD_CONTEXT);

        expect(chunkIn(snapshot, 'main.js')).toMatchObject({ entry: true, imports: ['vendors.js', 'vendors.css'], dynamicImports: ['shared.js'] });
        expect(chunkIn(snapshot, 'vendors.js')).toMatchObject({ entry: true, imports: ['main.js'], css: ['vendors.css'] });
        expect(chunkIn(snapshot, 'shared.js')).toMatchObject({ entry: false, dynamicEntry: false });
        expect(chunkIn(snapshot, 'shared.js').entryModule).toBeUndefined();
    });

    it('leaves out files the stats list for a chunk but not as an asset', () => {
        const snapshot = normalizeWebpackStats(stats({
            modules: [statsModule('src/index.js', { chunks: ['main'] })],
            chunks: [statsChunk('main', ['main.js', 'main.hot-update.js'], { initial: true })],
            assets: [statsAsset('main.js', 10)],
        }), BUILD_CONTEXT);

        expect(snapshot.chunks.map(chunk => chunk.id)).toEqual(['main.js']);
    });
});

describe('normalizeWebpackStats input', () => {
    const HOW = 'write complete stats with `stats.toJson({ all: true })`, or with `--json` and the stats option `all: true`, or add the @true-import-cost/webpack plugin to the build';

    it('says how to write usable stats when the stats have no modules, no chunks or no assets', () => {
        expect(() => normalizeWebpackStats({ version: '5.113.0', errorsCount: 0 }, BUILD_CONTEXT)).toThrow(`the webpack stats have no modules; ${HOW}`);
        expect(() => normalizeWebpackStats({ rspackVersion: '2.3.4', modules: [] }, BUILD_CONTEXT)).toThrow(`the Rspack stats have no chunks; ${HOW}`);
        expect(() => normalizeWebpackStats({ modules: [], chunks: [] }, BUILD_CONTEXT)).toThrow(`the webpack stats have no assets; ${HOW}`);
    });

    it('refuses stats that leave modules out or lack what connects modules to chunks and to each other', () => {
        const withoutChunks = { ...statsModule('src/index.js'), chunks: undefined };
        const withoutReasons = { ...statsModule('src/index.js'), reasons: undefined };
        const flat = { ...MAIN, modules: undefined };

        expect(() => normalizeWebpackStats({ ...APP, filteredModules: 3 }, BUILD_CONTEXT)).toThrow('the webpack stats leave out 3 modules;');
        expect(() => normalizeWebpackStats({ ...APP, modules: [withoutChunks] }, BUILD_CONTEXT)).toThrow('do not say which chunks the modules are in;');
        expect(() => normalizeWebpackStats({ ...APP, modules: [withoutReasons] }, BUILD_CONTEXT)).toThrow('do not list why each module was included');
        expect(() => normalizeWebpackStats({ ...APP, modules: [flat] }, BUILD_CONTEXT)).toThrow('do not list the modules inside concatenated modules;');
        expect(() => normalizeWebpackStats({ ...APP, modules: [{ name: './src/index.js', size: 1, chunks: [], reasons: [] }] }, BUILD_CONTEXT)).toThrow('list modules without an identifier or a name;');
        expect(() => normalizeWebpackStats({ ...APP, modules: [{ ...INDEX, size: -1 }] }, BUILD_CONTEXT)).toThrow('module "./src/index.js" is not a byte count');
    });

    it('reads the one compilation of multi-compiler stats, and refuses several', () => {
        expect(normalizeWebpackStats({ version: '5.113.0', children: [APP] }, BUILD_CONTEXT).modules).toHaveLength(9);
        expect(() => normalizeWebpackStats({ version: '5.113.0', children: [APP, APP] }, BUILD_CONTEXT)).toThrow(/describe 2 compilations; write the stats of each compilation to a file of its own/);
    });
});

describe('isWebpackStats', () => {
    it('recognises webpack and Rspack stats, even when they lack what True Import Cost needs', () => {
        for (const value of [APP, { version: '5.113.0', errorsCount: 0, warningsCount: 0 }, { rspackVersion: '2.3.4' }, { modules: [INDEX] }]) {
            expect(isWebpackStats(value)).toBe(true);
        }
    });

    it('rejects esbuild metafiles, snapshots, Rollup input and anything else', () => {
        for (const value of [null, [], {}, { inputs: {}, outputs: {} }, { format: 'webpack-stats', chunks: [] }, { format: 'true-import-cost/rollup-build', modules: [] }, { version: '1.0.0', name: 'package' }]) {
            expect(isWebpackStats(value)).toBe(false);
        }
    });
});

describe('webpackAdapter', () => {
    it('is picked for webpack stats and produces a valid snapshot', async () => {
        const result = await normalizeMetadata(APP, BUILD_CONTEXT);

        expect(result).toEqual({ ok: true, snapshot: normalizeWebpackStats(APP, BUILD_CONTEXT), adapter: 'webpack' });
        expect(webpackAdapter.supports(APP)).toBe(true);
    });

    it('turns incomplete stats into a failed result that says how to write them', async () => {
        const result = await normalizeMetadata({ rspackVersion: '2.3.4', errorsCount: 0 }, BUILD_CONTEXT);

        expect(!result.ok && result.error).toMatch(/^the Rspack stats have no modules; write complete stats/);
    });
});
