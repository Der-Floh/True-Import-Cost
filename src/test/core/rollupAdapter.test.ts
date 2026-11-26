import { describe, expect, it } from 'vitest';

import { BUILD_CONTEXT } from './support/esbuild';
import { at, BASE_DIR, rollupBuild, rollupChunk, rollupModule } from './support/rollup';
import { chunkIn, edgesFrom, moduleIn } from './support/snapshot';
import { encodeMappings } from './support/vlq';
import { normalizeMetadata } from '../../core/adapters/registry';
import { isCssModuleId, isRollupBuildInput, normalizeRollupBuild, rollupAdapter } from '../../core/adapters/rollup';
import { parseSnapshot } from '../../core/schema/validate';

import type { RollupBuildInput } from '../../core/adapters/rollup';
import type { BuildSnapshot, ModuleContribution } from '../../core/schema/snapshot';

const APP_STYLE = at('src/App.vue?vue&type=style&index=0&scoped=7a7a37b1&lang.css');

const VITE_APP = rollupBuild({
    modules: [
        rollupModule(at('src/main.ts'), {
            isEntry: true,
            importedIds: [at('src/App.vue'), at('src/style.css'), at('src/unused.ts'), 'vue'],
            dynamicallyImportedIds: [at('src/pages/About.vue')],
        }),
        rollupModule(at('src/App.vue'), { importedIds: [APP_STYLE, at('src/assets/logo.png'), 'vue', 'lodash-es'] }),
        rollupModule(APP_STYLE),
        rollupModule(at('src/assets/logo.png')),
        rollupModule(at('src/style.css')),
        rollupModule(at('src/unused.ts')),
        rollupModule(at('src/pages/About.vue'), { importedIds: ['vue'] }),
        rollupModule('vue', { isExternal: true }),
        rollupModule('lodash-es', { isExternal: true }),
        rollupModule('\0vite/preload-helper.js'),
    ],
    chunks: [
        rollupChunk('assets/index-a1.js', {
            isEntry: true,
            facadeModuleId: at('src/main.ts'),
            modules: { [at('src/main.ts')]: 300, [at('src/App.vue')]: 500, [APP_STYLE]: 0, [at('src/style.css')]: 0, [at('src/assets/logo.png')]: 40, '\0vite/preload-helper.js': 160 },
            imports: ['vue'],
            dynamicImports: ['assets/About-b2.js'],
            importedCss: ['assets/index-c3.css'],
            importedAssets: ['assets/logo-d4.png'],
        }),
        rollupChunk('assets/About-b2.js', {
            isDynamicEntry: true,
            facadeModuleId: at('src/pages/About.vue'),
            modules: { [at('src/pages/About.vue')]: 220 },
            imports: ['vue'],
        }),
    ],
    assets: [
        { fileName: 'assets/index-c3.css', bytes: 800 },
        { fileName: 'assets/logo-d4.png', bytes: 4000, originalFileNames: [at('src/assets/logo.png')] },
        { fileName: 'assets/index-a1.js.map', bytes: 9000 },
        { fileName: 'favicon.ico', bytes: 1500 },
    ],
    cssSourceLengths: { [at('src/style.css')]: 300, [APP_STYLE]: 100 },
});

function contributionsOf(snapshot: BuildSnapshot, id: string): readonly ModuleContribution[] {
    return moduleIn(snapshot, id).contributions;
}

describe('normalizeRollupBuild', () => {
    const snapshot = normalizeRollupBuild(VITE_APP, BUILD_CONTEXT);

    it('names modules by their path relative to the base directory', () => {
        expect(moduleIn(snapshot, 'src/main.ts')).toMatchObject({ path: 'src/main.ts', entry: true });
        expect(moduleIn(snapshot, 'src/main.ts').virtual).toBeUndefined();
    });

    it('keeps the query of a module id in the id but not in the path', () => {
        expect(moduleIn(snapshot, 'src/App.vue?vue&type=style&index=0&scoped=7a7a37b1&lang.css').path).toBe('src/App.vue');
    });

    it('keeps rollup virtual modules verbatim and flags them as virtual', () => {
        expect(moduleIn(snapshot, '\0vite/preload-helper.js')).toMatchObject({ path: 'vite/preload-helper.js', virtual: true });
    });

    it('leaves external modules out of the module list', () => {
        expect(snapshot.modules.map(module => module.id)).not.toContain('vue');
        expect(snapshot.modules.map(module => module.id)).not.toContain('lodash-es');
    });

    it('records static and dynamic imports between bundled modules', () => {
        expect(edgesFrom(snapshot, 'src/main.ts').filter(edge => !edge.external)).toEqual([
            { importer: 'src/main.ts', resolvedModule: 'src/App.vue', kind: 'static', external: false },
            { importer: 'src/main.ts', resolvedModule: 'src/style.css', kind: 'static', external: false },
            { importer: 'src/main.ts', resolvedModule: 'src/unused.ts', kind: 'static', external: false },
            { importer: 'src/main.ts', resolvedModule: 'src/pages/About.vue', kind: 'dynamic', external: false },
        ]);
    });

    it('marks an external import a chunk still contains as retained and one no chunk contains as not retained', () => {
        expect(edgesFrom(snapshot, 'src/App.vue').filter(edge => edge.external)).toEqual([
            { importer: 'src/App.vue', specifier: 'vue', kind: 'static', external: true, retained: true },
            { importer: 'src/App.vue', specifier: 'lodash-es', kind: 'static', external: true, retained: false },
        ]);
    });

    it('takes the rendered length of each module as its size when the chunk is big enough', () => {
        expect(contributionsOf(snapshot, 'src/App.vue')).toEqual([{ chunkId: 'assets/index-a1.js', bytes: 500, precision: 'rendered-length' }]);
        expect(contributionsOf(snapshot, 'src/pages/About.vue')).toEqual([{ chunkId: 'assets/About-b2.js', bytes: 220, precision: 'rendered-length' }]);
    });

    it('keeps a module that was tree-shaken away without contributions', () => {
        expect(contributionsOf(snapshot, 'src/unused.ts')).toEqual([]);
    });

    it('splits a CSS file between the CSS modules of the chunk that imports it, by source length', () => {
        expect(contributionsOf(snapshot, 'src/style.css')).toEqual([{ chunkId: 'assets/index-c3.css', bytes: 600, precision: 'proportional-estimate' }]);
        expect(contributionsOf(snapshot, 'src/App.vue?vue&type=style&index=0&scoped=7a7a37b1&lang.css'))
            .toEqual([{ chunkId: 'assets/index-c3.css', bytes: 200, precision: 'proportional-estimate' }]);
        expect(chunkIn(snapshot, 'assets/index-c3.css')).toEqual({
            id: 'assets/index-c3.css',
            kind: 'css',
            bytes: 800,
            entry: false,
            dynamicEntry: false,
            imports: [],
            dynamicImports: [],
            css: [],
            assets: [],
        });
    });

    it('credits an emitted asset to the module it was built from', () => {
        expect(contributionsOf(snapshot, 'src/assets/logo.png')).toEqual([
            { chunkId: 'assets/index-a1.js', bytes: 40, precision: 'rendered-length' },
            { chunkId: 'assets/logo-d4.png', bytes: 4000, precision: 'bundler-reported' },
        ]);
    });

    it('records the remaining outputs as assets of their kind', () => {
        expect(snapshot.assets).toEqual([
            { id: 'assets/logo-d4.png', kind: 'image', bytes: 4000 },
            { id: 'assets/index-a1.js.map', kind: 'sourcemap', bytes: 9000 },
            { id: 'favicon.ico', kind: 'image', bytes: 1500 },
        ]);
    });

    it('records JS chunks with their entry flags, facade module and links to chunks, CSS and assets', () => {
        expect(chunkIn(snapshot, 'assets/index-a1.js')).toEqual({
            id: 'assets/index-a1.js',
            kind: 'js',
            bytes: 1000,
            entry: true,
            dynamicEntry: false,
            entryModule: 'src/main.ts',
            imports: [],
            dynamicImports: ['assets/About-b2.js'],
            css: ['assets/index-c3.css'],
            assets: ['assets/logo-d4.png'],
        });
        expect(chunkIn(snapshot, 'assets/About-b2.js')).toMatchObject({ entry: false, dynamicEntry: true, entryModule: 'src/pages/About.vue' });
    });

    it('names the bundler rollup and takes the rest from the context', () => {
        expect(snapshot).toMatchObject({ id: 'app@1700000000000', target: 'app', bundler: { name: 'rollup' }, root: '.' });
    });

    it('produces a snapshot that passes validation', () => {
        expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual({ ok: true, snapshot });
    });
});

describe('normalizeRollupBuild size estimates', () => {
    it('scales rendered lengths down proportionally when they add up to more than the chunk', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/a.ts'), { isEntry: true }), rollupModule(at('src/b.ts'))],
            chunks: [rollupChunk('a.js', { bytes: 500, modules: { [at('src/a.ts')]: 600, [at('src/b.ts')]: 400 } })],
        }), BUILD_CONTEXT);

        expect(contributionsOf(snapshot, 'src/a.ts')).toEqual([{ chunkId: 'a.js', bytes: 300, precision: 'proportional-estimate' }]);
        expect(contributionsOf(snapshot, 'src/b.ts')).toEqual([{ chunkId: 'a.js', bytes: 200, precision: 'proportional-estimate' }]);
    });

    it('measures modules from the chunk source map and estimates the rest from what is left', () => {
        const code = `${'a'.repeat(10)}${'b'.repeat(5)}ccc`;
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/a.ts'), { isEntry: true, importedIds: [at('src/b.ts')] }), rollupModule(at('src/b.ts')), rollupModule('\0helper.js')],
            chunks: [rollupChunk('assets/index.js', {
                bytes: code.length,
                modules: { [at('src/a.ts')]: 40, [at('src/b.ts')]: 20, '\0helper.js': 3 },
                code,
                map: {
                    sources: ['../../src/a.ts', '../../src/b.ts'],
                    mappings: encodeMappings([[{ column: 0, source: 0 }, { column: 10, source: 1 }, { column: 15 }]]),
                },
            })],
        }), BUILD_CONTEXT);

        expect(contributionsOf(snapshot, 'src/a.ts')).toEqual([{ chunkId: 'assets/index.js', bytes: 10, precision: 'sourcemap-estimate' }]);
        expect(contributionsOf(snapshot, 'src/b.ts')).toEqual([{ chunkId: 'assets/index.js', bytes: 5, precision: 'sourcemap-estimate' }]);
        expect(contributionsOf(snapshot, '\0helper.js')).toEqual([{ chunkId: 'assets/index.js', bytes: 3, precision: 'rendered-length' }]);
    });

    it('splits the mapped bytes of one file between the modules built from it', () => {
        const code = 'x'.repeat(12);
        const script = at('src/App.vue?vue&type=script&setup=true&lang.ts');
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/App.vue'), { isEntry: true, importedIds: [script] }), rollupModule(script)],
            chunks: [rollupChunk('assets/index.js', {
                bytes: 12,
                modules: { [at('src/App.vue')]: 30, [script]: 90 },
                code,
                map: { sources: ['../../src/App.vue'], mappings: encodeMappings([[{ column: 0, source: 0 }]]) },
            })],
        }), BUILD_CONTEXT);

        expect(contributionsOf(snapshot, 'src/App.vue')).toEqual([{ chunkId: 'assets/index.js', bytes: 3, precision: 'sourcemap-estimate' }]);
        expect(contributionsOf(snapshot, 'src/App.vue?vue&type=script&setup=true&lang.ts'))
            .toEqual([{ chunkId: 'assets/index.js', bytes: 9, precision: 'sourcemap-estimate' }]);
    });

    it('resolves source map sources against its source root', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/a.ts'), { isEntry: true })],
            chunks: [rollupChunk('a.js', {
                bytes: 4,
                modules: { [at('src/a.ts')]: 100 },
                code: 'aaaa',
                map: { sourceRoot: '../src/', sources: ['a.ts'], mappings: encodeMappings([[{ column: 0, source: 0 }]]) },
            })],
        }), BUILD_CONTEXT);

        expect(contributionsOf(snapshot, 'src/a.ts')).toEqual([{ chunkId: 'a.js', bytes: 4, precision: 'sourcemap-estimate' }]);
    });

    it('falls back to rendered lengths when the source map cannot be decoded', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/a.ts'), { isEntry: true })],
            chunks: [rollupChunk('a.js', {
                bytes: 50,
                modules: { [at('src/a.ts')]: 40 },
                code: 'a'.repeat(50),
                map: { sources: ['../src/a.ts'], mappings: 'A*AA' },
            })],
        }), BUILD_CONTEXT);

        expect(contributionsOf(snapshot, 'src/a.ts')).toEqual([{ chunkId: 'a.js', bytes: 40, precision: 'rendered-length' }]);
    });
});

describe('normalizeRollupBuild externals', () => {
    it('treats an id a chunk imports that is not a chunk as external even without module info', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/main.ts'), { isEntry: true, importedIds: ['react'] })],
            chunks: [rollupChunk('main.js', { modules: { [at('src/main.ts')]: 10 }, imports: ['react'] })],
        }), BUILD_CONTEXT);

        expect(snapshot.imports).toEqual([{ importer: 'src/main.ts', specifier: 'react', kind: 'static', external: true, retained: true }]);
        expect(snapshot.modules.map(module => module.id)).toEqual(['src/main.ts']);
    });

    it('treats a bare id that was never rendered as external', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/main.ts'), { isEntry: true, importedIds: ['node:fs'], dynamicallyImportedIds: ['chart.js'] })],
            chunks: [rollupChunk('main.js', { modules: { [at('src/main.ts')]: 10 } })],
        }), BUILD_CONTEXT);

        expect(snapshot.imports).toEqual([
            { importer: 'src/main.ts', specifier: 'node:fs', kind: 'static', external: true, retained: false },
            { importer: 'src/main.ts', specifier: 'chart.js', kind: 'dynamic', external: true, retained: false },
        ]);
    });

    it('keeps a rendered module with a bare-looking id as a bundled virtual module', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/main.ts'), { isEntry: true, importedIds: ['virtual:pwa-register'] }), rollupModule('virtual:pwa-register')],
            chunks: [rollupChunk('main.js', { modules: { [at('src/main.ts')]: 10, 'virtual:pwa-register': 25 } })],
        }), BUILD_CONTEXT);

        expect(moduleIn(snapshot, 'virtual:pwa-register')).toMatchObject({ path: 'virtual:pwa-register', virtual: true });
        expect(snapshot.imports).toEqual([{ importer: 'src/main.ts', resolvedModule: 'virtual:pwa-register', kind: 'static', external: false }]);
    });

    it('leaves out the facade module of a chunk when it is external or missing', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/main.ts'), { isEntry: true }), rollupModule('vue', { isExternal: true })],
            chunks: [
                rollupChunk('main.js', { isEntry: true, facadeModuleId: 'vue', modules: { [at('src/main.ts')]: 10 } }),
                rollupChunk('shared.js', { modules: {} }),
            ],
        }), BUILD_CONTEXT);

        expect(snapshot.chunks.map(chunk => chunk.entryModule)).toEqual([undefined, undefined]);
    });
});

describe('normalizeRollupBuild CSS and assets', () => {
    function cssBuild(spec: Partial<RollupBuildInput>): BuildSnapshot {
        return normalizeRollupBuild(rollupBuild({
            modules: [
                rollupModule(at('src/main.ts'), { isEntry: true, importedIds: [at('src/a.css'), at('src/b.scss'), at('src/theme.css?inline')] }),
                rollupModule(at('src/a.css')),
                rollupModule(at('src/b.scss')),
                rollupModule(at('src/theme.css?inline')),
            ],
            chunks: [rollupChunk('main.js', { modules: { [at('src/main.ts')]: 100, [at('src/a.css')]: 0, [at('src/b.scss')]: 0, [at('src/theme.css?inline')]: 60 } })],
            ...spec,
        }), BUILD_CONTEXT);
    }

    it('gives a CSS file that no chunk claims to every CSS module of the build', () => {
        const snapshot = cssBuild({
            assets: [{ fileName: 'style.css', bytes: 900 }],
            cssSourceLengths: { [at('src/a.css')]: 200, [at('src/b.scss')]: 100 },
        });

        expect(contributionsOf(snapshot, 'src/a.css')).toEqual([{ chunkId: 'style.css', bytes: 600, precision: 'proportional-estimate' }]);
        expect(contributionsOf(snapshot, 'src/b.scss')).toEqual([{ chunkId: 'style.css', bytes: 300, precision: 'proportional-estimate' }]);
        expect(chunkIn(snapshot, 'style.css')).toMatchObject({ kind: 'css', bytes: 900 });
        expect(snapshot.assets).toEqual([]);
    });

    it('splits a CSS file evenly when the source lengths are unknown', () => {
        const snapshot = cssBuild({ assets: [{ fileName: 'style.css', bytes: 900 }] });

        expect(contributionsOf(snapshot, 'src/a.css')[0]?.bytes).toBe(450);
        expect(contributionsOf(snapshot, 'src/b.scss')[0]?.bytes).toBe(450);
    });

    it('does not count CSS imported as a string as a CSS module', () => {
        const snapshot = cssBuild({ assets: [{ fileName: 'style.css', bytes: 900 }] });

        expect(contributionsOf(snapshot, 'src/theme.css?inline')).toEqual([{ chunkId: 'main.js', bytes: 60, precision: 'rendered-length' }]);
    });

    it('ignores CSS files a chunk claims but the build did not emit', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/main.ts'), { isEntry: true })],
            chunks: [rollupChunk('main.js', { modules: { [at('src/main.ts')]: 10 }, importedCss: ['gone.css'], importedAssets: ['gone.png'] })],
        }), BUILD_CONTEXT);

        expect(snapshot.chunks.map(chunk => chunk.id)).toEqual(['main.js']);
        expect(chunkIn(snapshot, 'main.js')).toMatchObject({ css: [], assets: [] });
    });

    it('resolves relative original file names of an asset against the base directory', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/main.ts'), { isEntry: true, importedIds: [at('src/hero.webp')] }), rollupModule(at('src/hero.webp'))],
            chunks: [rollupChunk('main.js', { modules: { [at('src/main.ts')]: 10, [at('src/hero.webp')]: 30 } })],
            assets: [{ fileName: 'assets/hero-1.webp', bytes: 7000, originalFileNames: ['src/hero.webp', 'src/missing.webp'] }],
        }), BUILD_CONTEXT);

        expect(contributionsOf(snapshot, 'src/hero.webp')).toContainEqual({ chunkId: 'assets/hero-1.webp', bytes: 7000, precision: 'bundler-reported' });
        expect(parseSnapshot(snapshot).ok).toBe(true);
    });
});

describe('normalizeRollupBuild paths', () => {
    it('names modules outside the base directory relative to it', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/main.ts'), { isEntry: true, importedIds: ['/work/shared/util.ts'] }), rollupModule('/work/shared/util.ts')],
            chunks: [rollupChunk('main.js', { modules: { [at('src/main.ts')]: 10, '/work/shared/util.ts': 5 } })],
        }), BUILD_CONTEXT);

        expect(snapshot.modules.map(module => module.id)).toEqual(['src/main.ts', '../shared/util.ts']);
    });

    it('handles Windows paths and a base directory with a lower-case drive letter', () => {
        const snapshot = normalizeRollupBuild(rollupBuild({
            baseDir: 'c:\\work\\app',
            outDir: 'c:\\work\\app\\dist',
            modules: [
                rollupModule('C:/work/app/src/main.ts', { isEntry: true, importedIds: ['C:/work/app/node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js'] }),
                rollupModule('C:/work/app/node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js'),
            ],
            chunks: [rollupChunk('assets/index.js', {
                facadeModuleId: 'C:/work/app/src/main.ts',
                modules: { 'C:/work/app/src/main.ts': 10, 'C:/work/app/node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js': 20 },
            })],
        }), BUILD_CONTEXT);

        expect(snapshot.modules.map(module => module.id)).toEqual(['src/main.ts', 'node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js']);
        expect(snapshot.modules[1]).toMatchObject({ packageName: 'ms', packageVersion: '2.1.3', packageRoot: 'node_modules/.pnpm/ms@2.1.3/node_modules/ms' });
        expect(snapshot.chunks[0]?.entryModule).toBe('src/main.ts');
    });

    it('names a virtual module that wraps a real file by its relative path and flags it as virtual', () => {
        const proxy = `\0${BASE_DIR}/node_modules/ms/index.js?commonjs-proxy`;
        const snapshot = normalizeRollupBuild(rollupBuild({
            modules: [rollupModule(at('src/main.ts'), { isEntry: true, importedIds: [proxy] }), rollupModule(proxy)],
            chunks: [rollupChunk('main.js', { modules: { [at('src/main.ts')]: 10, [proxy]: 5 } })],
        }), BUILD_CONTEXT);

        expect(moduleIn(snapshot, '\0node_modules/ms/index.js?commonjs-proxy')).toMatchObject({
            path: 'node_modules/ms/index.js',
            virtual: true,
            packageName: 'ms',
        });
    });
});

describe('isCssModuleId', () => {
    it('recognises style sheets, Vue style blocks and lang queries', () => {
        for (const id of ['/a/style.css', '/a/theme.SCSS', '/a/x.less', '/a/x.styl', '/a/x.pcss', '/a/App.vue?vue&type=style&index=0&lang.css', '/a/App.vue?vue&lang.scss', '\0/a/virtual.css']) {
            expect(isCssModuleId(id), id).toBe(true);
        }
    });

    it('rejects CSS imported as a string or URL and anything that is not a style sheet', () => {
        for (const id of ['/a/style.css?inline', '/a/style.css?raw', '/a/style.css?url', '/a/style.css?used&inline', '/a/main.ts', '/a/App.vue?vue&type=script&lang.ts']) {
            expect(isCssModuleId(id), id).toBe(false);
        }
    });
});

describe('isRollupBuildInput', () => {
    it('requires the rollup-build format marker and chunk and module lists', () => {
        expect(isRollupBuildInput(VITE_APP)).toBe(true);
        expect(isRollupBuildInput({ ...VITE_APP, format: 'true-import-cost/build-snapshot' })).toBe(false);
        expect(isRollupBuildInput({ ...VITE_APP, chunks: {} })).toBe(false);
        expect(isRollupBuildInput({ format: 'true-import-cost/rollup-build' })).toBe(false);
    });
});

describe('rollupAdapter', () => {
    it('is picked for rollup build input and produces a valid snapshot', async () => {
        const result = await normalizeMetadata(VITE_APP, BUILD_CONTEXT);

        expect(result).toEqual({ ok: true, snapshot: normalizeRollupBuild(VITE_APP, BUILD_CONTEXT), adapter: 'rollup' });
        expect(rollupAdapter.supports(VITE_APP)).toBe(true);
    });
});
