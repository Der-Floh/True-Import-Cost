import { describe, expect, it } from 'vitest';

import { loadedTarget } from './support/dashboard';
import { fixture, inPackage } from '../core/support/snapshot';
import { parseBudgets } from '../../core/budgets';
import { BuildGraph } from '../../core/graph/buildGraph';
import { buildDashboardModel, targetComparison, treemapOf } from '../../extension/dashboard/dashboardModel';

import type { BuildSnapshot } from '../../core/schema/snapshot';
import type { Baseline } from '../../extension/services/baselineStore';
import type { TreemapNodeDto } from '../../shared/dashboard';

function webview() {
    const snapshot = fixture()
        .module('index.html', 300, { entry: true, chunk: 'index.html' })
        .module('src/main.ts', 400, { chunk: 'assets/index-AAAA1111.js' })
        .module('src/components/Card.vue', 900, { chunk: 'assets/index-AAAA1111.js' })
        .module('src/components/Lazy.vue', 600, { chunk: 'assets/Lazy-BBBB2222.js' })
        .module('src/style.css', 120, { chunk: 'assets/index-CCCC3333.css' })
        .module('node_modules/vue/dist/vue.js', 50_000, { ...inPackage('vue', '3.5.0'), chunk: 'assets/index-AAAA1111.js' })
        .module('node_modules/lodash-es/debounce.js', 1_000, { ...inPackage('lodash-es', '4.17.21'), chunk: 'assets/index-AAAA1111.js' })
        .module('node_modules/lodash-es/throttle.js', 800, { ...inPackage('lodash-es', '4.17.21'), chunk: 'assets/Lazy-BBBB2222.js' })
        .module('node_modules/widget/node_modules/lodash-es/debounce.js', 700, {
            ...inPackage('lodash-es', '4.0.0', 'node_modules/widget/node_modules/lodash-es'),
            chunk: 'assets/index-AAAA1111.js',
        })
        .module('\0vite/preload-helper.js', 250, { path: 'vite/preload-helper.js', chunk: 'assets/index-AAAA1111.js' })
        .module('src/logo.png', 4_000, { chunk: 'assets/logo-DDDD4444.png' })
        .chunk({ id: 'assets/index-AAAA1111.js', bytes: 53_000, entry: true, entryModule: 'index.html', css: ['assets/index-CCCC3333.css'], dynamicImports: ['assets/Lazy-BBBB2222.js'] })
        .chunk({ id: 'assets/Lazy-BBBB2222.js', bytes: 1_400, dynamicEntry: true, entryModule: 'src/components/Lazy.vue' })
        .chunk({ id: 'assets/index-CCCC3333.css', bytes: 120 })
        .asset({ id: 'index.html', kind: 'html', bytes: 300 })
        .asset({ id: 'assets/logo-DDDD4444.png', kind: 'image', bytes: 4_000 })
        .asset({ id: 'assets/index-AAAA1111.js.map', kind: 'sourcemap', bytes: 90_000 })
        .snapshot();
    return { ...snapshot, modules: snapshot.modules.map(module => (module.id.startsWith('\0') ? { ...module, virtual: true } : module)) };
}

function find(node: TreemapNodeDto, id: string): TreemapNodeDto | undefined {
    if (node.id === id) {
        return node;
    }
    for (const child of node.children ?? []) {
        const found = find(child, id);
        if (found) {
            return found;
        }
    }
    return undefined;
}

function baselineOf(snapshot: BuildSnapshot): Baseline {
    return { source: 'pinned', label: 'Pinned build', savedAt: 0, graph: new BuildGraph(snapshot) };
}

describe('the treemap of a build', () => {
    const treemap = treemapOf(new BuildGraph(webview()), 'webview');

    it('holds the project sources, each package instance and the generated code, largest first', () => {
        expect(treemap.children?.map(node => [node.id, node.kind, node.bytes])).toEqual([
            ['package:node_modules/vue', 'package', 50_000],
            ['group:project', 'project', 6_320],
            ['package:node_modules/lodash-es', 'package', 1_800],
            ['package:node_modules/widget/node_modules/lodash-es', 'package', 700],
            ['group:generated', 'generated', 250],
        ]);
        expect(treemap.bytes).toBe(59_070);
    });

    it('labels the instances of a duplicated package with their version', () => {
        const instances = treemap.children?.filter(node => node.packageName === 'lodash-es');

        expect(instances?.map(node => [node.label, node.duplicate])).toEqual([['lodash-es 4.17.21', true], ['lodash-es 4.0.0', true]]);
        expect(find(treemap, 'package:node_modules/vue')).toMatchObject({ label: 'vue', duplicate: false });
    });

    it('nests project files by directory and names package files from the package root', () => {
        const project = find(treemap, 'group:project');
        const components = find(treemap, 'dir:src/components');

        expect(project?.label).toBe('Project sources');
        expect(components?.children?.map(node => [node.label, node.moduleId, node.openable])).toEqual([
            ['Card.vue', 'src/components/Card.vue', true],
            ['Lazy.vue', 'src/components/Lazy.vue', true],
        ]);
        expect(find(treemap, 'package:node_modules/lodash-es')?.children?.map(node => node.label)).toEqual(['debounce.js', 'throttle.js']);
        expect(find(treemap, 'group:generated')?.children?.[0]).toMatchObject({ label: 'vite/preload-helper.js', openable: false });
    });

    it('marks what only loads lazily', () => {
        expect(find(treemap, 'module:src/components/Lazy.vue')?.lazy).toBe(true);
        expect(find(treemap, 'module:src/components/Card.vue')?.lazy).toBe(false);
        expect(find(treemap, 'package:node_modules/lodash-es')?.lazy).toBe(false);
    });

    it('collapses a chain of single directories into the group', () => {
        const nested = treemapOf(fixture()
            .module('src/app/main.ts', 10, { entry: true })
            .module('src/app/util.ts', 5)
            .graph(), 'x');

        expect(nested.children?.[0]?.label).toBe('Project sources (src/app/)');
        expect(nested.children?.[0]?.children?.map(node => node.label)).toEqual(['main.ts', 'util.ts']);
    });

    it('folds a long tail of small children into one tile', () => {
        const many = fixture();
        for (let index = 0; index < 200; index++) {
            many.module(`node_modules/huge/f${index}.js`, 1000 - index, inPackage('huge'));
        }
        const huge = treemapOf(many.graph(), 'x').children?.[0];

        expect(huge?.children).toHaveLength(150);
        expect(huge?.children?.at(-1)).toMatchObject({ id: 'other:package:node_modules/huge', label: '51 smaller', kind: 'other' });
        expect(huge?.children?.reduce((sum, node) => sum + node.bytes, 0)).toBe(huge?.bytes);
    });
});

describe('the dashboard model', () => {
    it('describes the build target and its totals, leaving source maps out', () => {
        const target = loadedTarget({ ...webview(), bundler: { name: 'vite', version: '8.3.8', engine: 'rolldown 1.2.19' }, mode: 'production' }, 'webview');
        const model = buildDashboardModel({ targets: [{ target }], selected: { target, metadataPath: 'web/.true-import-cost/webview.json', history: [] }, historyEnabled: true });

        expect(model.targets).toEqual([{ key: target.key, id: 'webview', bundler: 'vite 8.3.8 (rolldown 1.2.19)', mode: 'production', createdAt: 0, totalBytes: 58_820 }]);
        expect(model.selected?.totals).toEqual({ total: 58_820, javascript: 54_400, css: 120, assets: 4_300, initial: 53_120, lazy: 1_400 });
        expect(model.selected?.estimated).toBe(false);
        expect(model.comparison).toBeUndefined();
    });

    it('lists packages by name with their versions, lazy part and duplication', () => {
        const target = loadedTarget(webview(), 'webview');
        const model = buildDashboardModel({ targets: [{ target }], selected: { target, metadataPath: '', history: [] }, historyEnabled: true });

        expect(model.selected?.packages).toEqual([
            { name: 'vue', versions: ['3.5.0'], bytes: 50_000, lazyBytes: 0, modules: 1, duplicate: false },
            { name: 'lodash-es', versions: ['4.0.0', '4.17.21'], bytes: 2_500, lazyBytes: 800, modules: 3, duplicate: true },
        ]);
        expect(model.selected?.duplicates.map(duplicate => [duplicate.name, duplicate.instances.map(instance => instance.version)])).toEqual([['lodash-es', ['4.17.21', '4.0.0']]]);
    });

    it('lists initial chunks before lazy ones, and assets by kind without source maps', () => {
        const target = loadedTarget(webview(), 'webview');
        const selected = buildDashboardModel({ targets: [{ target }], selected: { target, metadataPath: '', history: [] }, historyEnabled: true }).selected;

        expect(selected?.chunks.map(chunk => [chunk.id, chunk.loading, chunk.entryModule])).toEqual([
            ['assets/index-AAAA1111.js', 'initial', 'index.html'],
            ['assets/index-CCCC3333.css', 'initial', undefined],
            ['assets/Lazy-BBBB2222.js', 'lazy', 'src/components/Lazy.vue'],
        ]);
        expect(selected?.assets).toEqual([
            { kind: 'image', bytes: 4_000, files: [{ id: 'assets/logo-DDDD4444.png', bytes: 4_000 }] },
            { kind: 'html', bytes: 300, files: [{ id: 'index.html', bytes: 300 }] },
        ]);
    });

    it('compares packages, chunks and modules with the baseline', () => {
        const before = fixture()
            .module('src/main.ts', 300, { entry: true, chunk: 'assets/index-ZZZZ9999.js' })
            .module('node_modules/vue/dist/vue.js', 49_000, { ...inPackage('vue', '3.4.0'), chunk: 'assets/index-ZZZZ9999.js' })
            .module('node_modules/moment/moment.js', 20_000, { ...inPackage('moment', '2.30.0'), chunk: 'assets/index-ZZZZ9999.js' })
            .chunk({ id: 'assets/index-ZZZZ9999.js', bytes: 70_000, entry: true, entryModule: 'index.html' })
            .snapshot();
        const target = loadedTarget(webview(), 'webview');
        const selected = buildDashboardModel({
            targets: [{ target }],
            selected: { target, metadataPath: '', history: [], baseline: { ...baselineOf(before), graph: new BuildGraph(before) } },
            historyEnabled: true,
        }).selected;

        expect(selected?.baseline).toMatchObject({ source: 'pinned', label: 'Pinned build', totals: { javascript: 70_000 } });
        expect(selected?.packages.map(row => [row.name, row.change?.status, row.change?.delta])).toEqual([
            ['vue', 'changed', 1_000],
            ['lodash-es', 'added', 2_500],
            ['moment', 'removed', -20_000],
        ]);
        expect(selected?.chunks.find(chunk => chunk.id === 'assets/index-AAAA1111.js')?.delta).toBe(-17_000);
        expect(selected?.moduleChanges[0]).toEqual({ id: 'node_modules/moment/moment.js', label: 'moment/moment.js', before: 20_000, after: 0, delta: -20_000 });
    });

    it('gives each chunk its own change when several share a name without its hash', () => {
        const build = (chunks: readonly (readonly [string, number, string])[]) => {
            const result = fixture().module('src/main.ts', 10, { entry: true, chunk: 'dist/main.js' }).chunk({ id: 'dist/main.js', bytes: 10, entry: true, entryModule: 'src/main.ts' });
            for (const [id, bytes, module] of chunks) {
                result.module(module, bytes, { chunk: id }).chunk({ id, bytes });
            }
            return result.snapshot();
        };
        const before = build([['dist/chunk-AAAA1111.js', 1_000, 'src/a.ts'], ['dist/chunk-BBBB2222.js', 2_000, 'src/b.ts']]);
        const target = loadedTarget(build([['dist/chunk-CCCC3333.js', 2_500, 'src/b.ts'], ['dist/chunk-DDDD4444.js', 900, 'src/a.ts']]), 'split');
        const selected = buildDashboardModel({
            targets: [{ target }],
            selected: { target, metadataPath: '', history: [], baseline: baselineOf(before) },
            historyEnabled: true,
        }).selected;

        expect(selected?.chunks.map(chunk => [chunk.id, chunk.delta])).toEqual([
            ['dist/main.js', 0],
            ['dist/chunk-CCCC3333.js', 500],
            ['dist/chunk-DDDD4444.js', -100],
        ]);
    });

    it('checks the budget and marks packages over theirs', () => {
        const target = loadedTarget(webview(), 'webview');
        const budget = parseBudgets({ webview: { initial: '50 kB', packages: { 'lodash*': '2 kB' } } }).get('webview');
        const selected = buildDashboardModel({ targets: [{ target }], selected: { target, metadataPath: '', history: [], budget }, historyEnabled: true }).selected;

        expect(selected?.budgets).toEqual([
            { kind: 'initial', label: 'Initial load', limit: 50_000, actual: 53_120, exceeded: true },
            { kind: 'package', label: 'lodash-es', limit: 2_000, actual: 2_500, exceeded: true },
        ]);
        expect(selected?.packages.find(row => row.name === 'lodash-es')?.budget).toEqual({ kind: 'package', label: 'lodash-es', limit: 2_000, actual: 2_500, exceeded: true });
    });

    it('turns the history into points', () => {
        const target = loadedTarget(webview(), 'webview');
        const totals = { total: 10, javascript: 6, css: 1, assets: 3, initial: 5, lazy: 2 };
        const selected = buildDashboardModel({
            targets: [{ target }],
            selected: { target, metadataPath: '', history: [{ fingerprint: 'a', createdAt: 5, totals, packages: [] }] },
            historyEnabled: true,
        }).selected;

        expect(selected?.history).toEqual([{ createdAt: 5, total: 10, javascript: 6, css: 1, initial: 5 }]);
    });

    it('says when sizes are estimates', () => {
        const estimated = fixture().module('a.ts', 10, { entry: true, precision: 'proportional-estimate' }).snapshot();
        const target = loadedTarget(estimated, 'x');

        expect(buildDashboardModel({ targets: [{ target }], selected: { target, metadataPath: '', history: [] }, historyEnabled: true }).selected?.estimated).toBe(true);
    });

    it('reports a target whose last update failed', () => {
        const target = loadedTarget(webview(), 'webview');

        expect(buildDashboardModel({ targets: [{ target, failure: 'the file is not valid JSON' }], historyEnabled: false }).targets[0]?.failure).toBe('the file is not valid JSON');
    });
});

describe('comparing build targets', () => {
    it('lines up the size of each package in each target, largest first', () => {
        const host = loadedTarget(fixture()
            .module('src/extension.ts', 10, { entry: true })
            .module('node_modules/lodash-es/debounce.js', 4_000, inPackage('lodash-es'))
            .module('node_modules/zod/index.js', 9_000, inPackage('zod'))
            .snapshot(), 'extension-host');
        const web = loadedTarget(webview(), 'webview');

        const comparison = targetComparison([host, web]);

        expect(comparison?.targets.map(target => target.id)).toEqual(['extension-host', 'webview']);
        expect(comparison?.rows).toEqual([
            { name: 'vue', bytes: [null, 50_000] },
            { name: 'zod', bytes: [9_000, null] },
            { name: 'lodash-es', bytes: [4_000, 2_500] },
        ]);
    });

    it('is left out with a single target', () => {
        expect(targetComparison([loadedTarget(webview(), 'webview')])).toBeUndefined();
    });
});
