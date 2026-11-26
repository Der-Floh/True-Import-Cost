import { describe, expect, it } from 'vitest';

import { BUILD_CONTEXT, input, metafile, output, statement } from './support/esbuild';
import { fixture, inPackage } from './support/snapshot';
import { normalizeEsbuildMetafile } from '../../core/adapters/esbuild';
import { BuildGraph } from '../../core/graph/buildGraph';
import { duplicateOf, duplicatePackages } from '../../core/graph/duplicates';
import { followsEagerly, followsInclusion, reachableFrom } from '../../core/graph/reachability';

const LODASH_4 = inPackage('lodash', '4.17.21');
const LODASH_3 = inPackage('lodash', '3.10.1', 'node_modules/legacy-widget/node_modules/lodash');

describe('BuildGraph lookups', () => {
    const graph = fixture()
        .module('src/main.ts', 100, { entry: true })
        .module('src/App.vue', 50)
        .module('src/App.vue?vue&type=script&setup=true&lang.ts', 300, { path: 'src/App.vue' })
        .imports('src/main.ts', 'src/App.vue', { specifier: './App.vue' })
        .imports('src/App.vue', 'src/App.vue?vue&type=script&setup=true&lang.ts')
        .external('src/main.ts', 'vue', { retained: true })
        .graph();

    it('finds modules by id and every module built from a path', () => {
        expect(graph.module('src/main.ts')?.path).toBe('src/main.ts');
        expect(graph.modulesAt('src/App.vue').map(module => module.id)).toEqual(['src/App.vue', 'src/App.vue?vue&type=script&setup=true&lang.ts']);
        expect(graph.moduleCount).toBe(3);
        expect([...graph.modules()].map(module => module.id)).toEqual(['src/main.ts', 'src/App.vue', 'src/App.vue?vue&type=script&setup=true&lang.ts']);
    });

    it('lists the imports of a module, externals included, and who imports a module', () => {
        expect(graph.importsOf('src/main.ts').map(edge => edge.resolvedModule ?? edge.specifier)).toEqual(['src/App.vue', 'vue']);
        expect(graph.importersOf('src/App.vue').map(edge => edge.importer)).toEqual(['src/main.ts']);
        expect(graph.importersOf('src/main.ts')).toEqual([]);
    });

    it('answers with empty results for ids and paths it does not know', () => {
        expect(graph.module('src/gone.ts')).toBeUndefined();
        expect(graph.modulesAt('src/gone.ts')).toEqual([]);
        expect(graph.importsOf('src/gone.ts')).toEqual([]);
        expect(graph.importersOf('src/gone.ts')).toEqual([]);
        expect(graph.bytesOf('src/gone.ts')).toBe(0);
        expect(graph.precisionOf('src/gone.ts')).toBeUndefined();
    });
});

describe('BuildGraph sizes', () => {
    it('adds up the bytes of a module across outputs and reports its least precise measurement', () => {
        const graph = fixture()
            .module('src/logo.png', 0, {
                contributions: [
                    { chunkId: 'dist/main.js', bytes: 40, precision: 'rendered-length' },
                    { chunkId: 'dist/logo.png', bytes: 4000, precision: 'bundler-reported' },
                ],
            })
            .asset({ id: 'dist/logo.png', kind: 'image', bytes: 4000 })
            .graph();

        expect(graph.bytesOf('src/logo.png')).toBe(4040);
        expect(graph.precisionOf('src/logo.png')).toBe('rendered-length');
    });

    it('has no precision for a module without contributions', () => {
        const graph = fixture().module('src/unused.ts').graph();

        expect(graph.bytesOf('src/unused.ts')).toBe(0);
        expect(graph.precisionOf('src/unused.ts')).toBeUndefined();
    });
});

describe('BuildGraph packages', () => {
    const graph = fixture()
        .module('src/main.ts', 100, { entry: true })
        .module('node_modules/lodash/map.js', 300, LODASH_4)
        .module('node_modules/lodash/_baseMap.js', 200, LODASH_4)
        .module('node_modules/legacy-widget/node_modules/lodash/map.js', 250, LODASH_3)
        .graph();

    it('makes one package instance per install location', () => {
        expect([...graph.packages().values()]).toEqual([
            {
                key: 'node_modules/lodash',
                name: 'lodash',
                version: '4.17.21',
                root: 'node_modules/lodash',
                moduleIds: ['node_modules/lodash/map.js', 'node_modules/lodash/_baseMap.js'],
                bytes: 500,
            },
            {
                key: 'node_modules/legacy-widget/node_modules/lodash',
                name: 'lodash',
                version: '3.10.1',
                root: 'node_modules/legacy-widget/node_modules/lodash',
                moduleIds: ['node_modules/legacy-widget/node_modules/lodash/map.js'],
                bytes: 250,
            },
        ]);
    });

    it('finds the package instance a module belongs to', () => {
        expect(graph.packageOf('node_modules/lodash/_baseMap.js')?.version).toBe('4.17.21');
        expect(graph.packageOf('node_modules/legacy-widget/node_modules/lodash/map.js')?.version).toBe('3.10.1');
        expect(graph.packageOf('src/main.ts')).toBeUndefined();
        expect(graph.packageOf('src/gone.ts')).toBeUndefined();
    });

    it('builds the package map once', () => {
        expect(graph.packages()).toBe(graph.packages());
    });
});

describe('BuildGraph entries', () => {
    it('takes the modules marked as entries', () => {
        const graph = fixture()
            .module('src/web.ts', 10, { entry: true })
            .module('src/worker.ts', 10, { entry: true })
            .module('src/shared.ts', 10)
            .imports('src/web.ts', 'src/shared.ts')
            .graph();

        expect(graph.entries).toEqual(['src/web.ts', 'src/worker.ts']);
    });

    it('falls back to the entry modules of entry chunks', () => {
        const graph = fixture()
            .module('src/main.ts', 10)
            .module('src/lazy.ts', 10)
            .chunk({ id: 'dist/main.js', bytes: 10, entry: true, entryModule: 'src/main.ts' })
            .chunk({ id: 'dist/main.css', bytes: 10, entry: true, entryModule: 'src/main.ts' })
            .chunk({ id: 'dist/lazy.js', bytes: 10, dynamicEntry: true, entryModule: 'src/lazy.ts' })
            .graph();

        expect(graph.entries).toEqual(['src/main.ts']);
    });

    it('falls back to modules nothing imports that import something', () => {
        const graph = fixture()
            .module('src/main.ts', 10)
            .module('src/util.ts', 10)
            .module('src/orphan.ts', 10)
            .imports('src/main.ts', 'src/util.ts')
            .graph();

        expect(graph.entries).toEqual(['src/main.ts']);
    });
});

describe('reachableFrom', () => {
    const graph = fixture()
        .module('src/main.ts', 10, { entry: true })
        .module('src/static.ts', 10)
        .module('src/lazy.ts', 10)
        .module('src/lazy-dep.ts', 10)
        .module('src/legacy.cjs', 10)
        .module('src/style.css', 10)
        .module('src/font.woff2', 10)
        .module('src/worker.ts', 10, { entry: true })
        .imports('src/main.ts', 'src/static.ts')
        .imports('src/main.ts', 'src/lazy.ts', { kind: 'dynamic' })
        .imports('src/lazy.ts', 'src/lazy-dep.ts')
        .imports('src/static.ts', 'src/legacy.cjs', { kind: 'require' })
        .imports('src/static.ts', 'src/style.css', { kind: 'css' })
        .imports('src/style.css', 'src/font.woff2', { kind: 'reference' })
        .external('src/main.ts', 'vscode')
        .graph();

    it('follows static, dynamic, require and CSS imports but not references or externals', () => {
        expect([...reachableFrom(graph, ['src/main.ts'])].sort())
            .toEqual(['src/lazy-dep.ts', 'src/lazy.ts', 'src/legacy.cjs', 'src/main.ts', 'src/static.ts', 'src/style.css']);
    });

    it('leaves dynamic imports out when following eagerly', () => {
        expect([...reachableFrom(graph, ['src/main.ts'], followsEagerly)].sort())
            .toEqual(['src/legacy.cjs', 'src/main.ts', 'src/static.ts', 'src/style.css']);
    });

    it('starts from several roots and skips roots that are not modules', () => {
        expect([...reachableFrom(graph, ['src/worker.ts', 'src/lazy.ts', 'src/gone.ts'])].sort())
            .toEqual(['src/lazy-dep.ts', 'src/lazy.ts', 'src/worker.ts']);
        expect(reachableFrom(graph, ['src/gone.ts']).size).toBe(0);
    });

    it('accepts a custom edge filter', () => {
        expect([...reachableFrom(graph, ['src/main.ts'], edge => edge.kind === 'static')].sort()).toEqual(['src/main.ts', 'src/static.ts']);
    });

    it('terminates on circular imports', () => {
        const cyclic = fixture()
            .module('a', 1)
            .module('b', 1)
            .module('c', 1)
            .imports('a', 'b')
            .imports('b', 'c')
            .imports('c', 'a')
            .imports('c', 'c')
            .graph();

        expect([...reachableFrom(cyclic, ['b'])].sort()).toEqual(['a', 'b', 'c']);
    });
});

describe('edge filters', () => {
    it('include resolved, non-external edges and leave references out', () => {
        const base = { importer: 'a', resolvedModule: 'b', external: false } as const;

        expect(followsInclusion({ ...base, kind: 'static' })).toBe(true);
        expect(followsInclusion({ ...base, kind: 'dynamic' })).toBe(true);
        expect(followsInclusion({ ...base, kind: 'reference' })).toBe(false);
        expect(followsInclusion({ importer: 'a', specifier: 'vscode', kind: 'static', external: true })).toBe(false);
        expect(followsInclusion({ importer: 'a', kind: 'static', external: false })).toBe(false);
        expect(followsEagerly({ ...base, kind: 'dynamic' })).toBe(false);
        expect(followsEagerly({ ...base, kind: 'css' })).toBe(true);
    });
});

describe('duplicatePackages', () => {
    it('reports a package bundled from several install locations, largest instance first', () => {
        const graph = fixture()
            .module('node_modules/legacy-widget/node_modules/lodash/map.js', 250, LODASH_3)
            .module('node_modules/lodash/map.js', 300, LODASH_4)
            .module('node_modules/lodash/_baseMap.js', 200, LODASH_4)
            .module('node_modules/ms/index.js', 80, inPackage('ms', '2.1.3'))
            .graph();

        const duplicates = duplicatePackages(graph);

        expect(duplicates.map(duplicate => [duplicate.name, duplicate.bytes, duplicate.instances.map(instance => instance.version)]))
            .toEqual([['lodash', 750, ['4.17.21', '3.10.1']]]);
        expect(duplicateOf(graph, 'lodash')).toBe(duplicates[0]);
        expect(duplicateOf(graph, 'ms')).toBeUndefined();
    });

    it('does not count an install whose modules were all tree-shaken', () => {
        const graph = fixture()
            .module('node_modules/lodash/map.js', 300, LODASH_4)
            .module('node_modules/legacy-widget/node_modules/lodash/map.js', 0, LODASH_3)
            .graph();

        expect(duplicatePackages(graph)).toEqual([]);
    });

    it('orders duplicates by their total size', () => {
        const graph = fixture()
            .module('node_modules/a/node_modules/ms/index.js', 10, inPackage('ms', '1.0.0', 'node_modules/a/node_modules/ms'))
            .module('node_modules/ms/index.js', 10, inPackage('ms', '2.1.3'))
            .module('node_modules/lodash/map.js', 300, LODASH_4)
            .module('node_modules/legacy-widget/node_modules/lodash/map.js', 250, LODASH_3)
            .graph();

        expect(duplicatePackages(graph).map(duplicate => duplicate.name)).toEqual(['lodash', 'ms']);
    });

    it('computes the duplicates of a graph once', () => {
        const graph = fixture().module('node_modules/ms/index.js', 10, inPackage('ms')).graph();

        expect(duplicatePackages(graph)).toBe(duplicatePackages(graph));
    });

    it('tells two pnpm-installed versions of a package apart from a real esbuild metafile layout', () => {
        const v4 = 'node_modules/.pnpm/lodash@4.17.21/node_modules/lodash/lodash.js';
        const v3 = 'node_modules/.pnpm/lodash@3.10.1/node_modules/lodash/index.js';
        const graph = new BuildGraph(normalizeEsbuildMetafile(metafile(
            {
                'src/main.ts': input(100, [statement(v4, 'lodash'), statement('node_modules/.pnpm/legacy-widget@1.0.0/node_modules/legacy-widget/index.js', 'legacy-widget')]),
                'node_modules/.pnpm/legacy-widget@1.0.0/node_modules/legacy-widget/index.js': input(50, [statement(v3, 'lodash')]),
                [v4]: input(70_000),
                [v3]: input(40_000),
            },
            {
                'dist/main.js': output({
                    'src/main.ts': 90,
                    'node_modules/.pnpm/legacy-widget@1.0.0/node_modules/legacy-widget/index.js': 40,
                    [v4]: 24_000,
                    [v3]: 15_000,
                }, { entryPoint: 'src/main.ts' }),
            },
        ), BUILD_CONTEXT));

        expect(duplicateOf(graph, 'lodash')?.instances.map(instance => [instance.version, instance.root, instance.bytes])).toEqual([
            ['4.17.21', 'node_modules/.pnpm/lodash@4.17.21/node_modules/lodash', 24_000],
            ['3.10.1', 'node_modules/.pnpm/lodash@3.10.1/node_modules/lodash', 15_000],
        ]);
    });
});
