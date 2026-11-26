import { describe, expect, it } from 'vitest';

import { fixture, inPackage } from './support/snapshot';
import { importImpact } from '../../core/graph/impact';

const UI_KIT = inPackage('ui-kit', '2.0.0');

function sizes(impact: { bundledBytes: number; exclusiveBytes: number; sharedBytes: number; lazyBytes: number }): Record<string, number> {
    return { bundled: impact.bundledBytes, exclusive: impact.exclusiveBytes, shared: impact.sharedBytes, lazy: impact.lazyBytes };
}

describe('importImpact', () => {
    it('counts the imported module and everything it pulls in eagerly', () => {
        const graph = fixture()
            .module('src/main.ts', 100, { entry: true })
            .module('src/chart.ts', 200)
            .module('src/axis.ts', 50)
            .module('src/scale.ts', 30)
            .imports('src/main.ts', 'src/chart.ts')
            .imports('src/chart.ts', 'src/axis.ts')
            .imports('src/axis.ts', 'src/scale.ts')
            .graph();

        expect(importImpact(graph, ['src/main.ts'], 'src/chart.ts')).toEqual({
            moduleId: 'src/chart.ts',
            bundledBytes: 280,
            lazyBytes: 0,
            exclusiveBytes: 280,
            sharedBytes: 0,
            moduleCount: 3,
            retainedModuleCount: 3,
            exclusiveModuleCount: 3,
            precision: 'bundler-reported',
            packages: [{ key: undefined, name: undefined, bytes: 280 }],
        });
    });

    it('counts a dependency reached along several paths only once', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/a.ts', 100)
            .module('src/b.ts', 20)
            .module('src/c.ts', 30)
            .module('src/shared.ts', 400)
            .imports('src/main.ts', 'src/a.ts')
            .imports('src/a.ts', 'src/b.ts')
            .imports('src/a.ts', 'src/c.ts')
            .imports('src/b.ts', 'src/shared.ts')
            .imports('src/c.ts', 'src/shared.ts')
            .graph();

        expect(importImpact(graph, ['src/main.ts'], 'src/a.ts')).toMatchObject({ bundledBytes: 550, exclusiveBytes: 550, moduleCount: 4 });
    });

    it('splits the cost of two imports that reach a shared module into exclusive and shared bytes', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/x.ts', 100)
            .module('src/y.ts', 200)
            .module('src/shared.ts', 50)
            .imports('src/main.ts', 'src/x.ts')
            .imports('src/main.ts', 'src/y.ts')
            .imports('src/x.ts', 'src/shared.ts')
            .imports('src/y.ts', 'src/shared.ts')
            .graph();

        const x = importImpact(graph, ['src/main.ts'], 'src/x.ts');
        const y = importImpact(graph, ['src/main.ts'], 'src/y.ts');

        expect(sizes(x)).toEqual({ bundled: 150, exclusive: 100, shared: 50, lazy: 0 });
        expect([x.retainedModuleCount, x.exclusiveModuleCount]).toEqual([2, 1]);
        expect(sizes(y)).toEqual({ bundled: 250, exclusive: 200, shared: 50, lazy: 0 });
        expect(x.exclusiveBytes + y.exclusiveBytes + x.sharedBytes).toBe(350);
    });

    it('treats a module that another file also imports as shared', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/page.ts', 10)
            .module('src/other.ts', 10)
            .module('src/date.ts', 300)
            .imports('src/main.ts', 'src/page.ts')
            .imports('src/main.ts', 'src/other.ts')
            .imports('src/page.ts', 'src/date.ts')
            .imports('src/other.ts', 'src/date.ts')
            .graph();

        expect(sizes(importImpact(graph, ['src/page.ts'], 'src/date.ts'))).toEqual({ bundled: 300, exclusive: 0, shared: 300, lazy: 0 });
    });

    it('treats a module the document also reaches through another of its imports as shared', () => {
        const graph = fixture()
            .module('src/page.ts', 10, { entry: true })
            .module('src/date.ts', 300)
            .module('src/calendar.ts', 100)
            .imports('src/page.ts', 'src/date.ts')
            .imports('src/page.ts', 'src/calendar.ts')
            .imports('src/calendar.ts', 'src/date.ts')
            .graph();

        expect(importImpact(graph, ['src/page.ts'], 'src/date.ts').exclusiveBytes).toBe(0);
        expect(sizes(importImpact(graph, ['src/page.ts'], 'src/calendar.ts'))).toEqual({ bundled: 400, exclusive: 100, shared: 300, lazy: 0 });
    });

    it('treats a module every module of the document imports as exclusive to that document', () => {
        const script = 'src/App.vue?vue&type=script&setup=true&lang.ts';
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/App.vue', 40)
            .module(script, 120, { path: 'src/App.vue' })
            .module('src/format.ts', 300)
            .imports('src/main.ts', 'src/App.vue')
            .imports('src/App.vue', script)
            .imports('src/App.vue', 'src/format.ts')
            .imports(script, 'src/format.ts')
            .graph();

        expect(sizes(importImpact(graph, ['src/App.vue', script], 'src/format.ts'))).toEqual({ bundled: 300, exclusive: 300, shared: 0, lazy: 0 });
        expect(sizes(importImpact(graph, ['src/App.vue'], 'src/format.ts'))).toEqual({ bundled: 300, exclusive: 0, shared: 300, lazy: 0 });
    });

    it('treats a module another entry point reaches as shared', () => {
        const graph = fixture()
            .module('src/web.ts', 10, { entry: true })
            .module('src/worker.ts', 10, { entry: true })
            .module('src/codec.ts', 500)
            .imports('src/web.ts', 'src/codec.ts')
            .imports('src/worker.ts', 'src/codec.ts')
            .graph();

        expect(importImpact(graph, ['src/web.ts'], 'src/codec.ts').exclusiveBytes).toBe(0);
    });

    it('follows CSS imports but not externals or asset references', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/widget.ts', 100)
            .module('src/widget.css', 60, { chunk: 'dist/main.css' })
            .module('src/icon.svg', 900)
            .imports('src/main.ts', 'src/widget.ts')
            .imports('src/widget.ts', 'src/widget.css', { kind: 'css' })
            .imports('src/widget.css', 'src/icon.svg', { kind: 'reference' })
            .external('src/widget.ts', 'vscode', { retained: true })
            .graph();

        expect(importImpact(graph, ['src/main.ts'], 'src/widget.ts')).toMatchObject({ bundledBytes: 160, moduleCount: 2 });
    });
});

describe('importImpact of imports from one package barrel', () => {
    const graph = fixture()
        .module('src/main.ts', 10, { entry: true })
        .module('src/page.ts', 10)
        .module('src/settings.ts', 10)
        .module('node_modules/ui-kit/index.js', 20, UI_KIT)
        .module('node_modules/ui-kit/button.js', 300, UI_KIT)
        .module('node_modules/ui-kit/dialog.js', 500, UI_KIT)
        .module('node_modules/ui-kit/overlay.js', 200, UI_KIT)
        .module('node_modules/ui-kit/tabs.js', 150, UI_KIT)
        .module('node_modules/ui-kit/util.js', 100, UI_KIT)
        .imports('src/main.ts', 'src/page.ts')
        .imports('src/main.ts', 'src/settings.ts')
        .imports('src/page.ts', 'node_modules/ui-kit/button.js', { specifier: 'ui-kit/button' })
        .imports('src/page.ts', 'node_modules/ui-kit/dialog.js', { specifier: 'ui-kit/dialog' })
        .imports('src/settings.ts', 'node_modules/ui-kit/index.js', { specifier: 'ui-kit' })
        .imports('node_modules/ui-kit/index.js', 'node_modules/ui-kit/button.js')
        .imports('node_modules/ui-kit/index.js', 'node_modules/ui-kit/tabs.js')
        .imports('node_modules/ui-kit/button.js', 'node_modules/ui-kit/util.js')
        .imports('node_modules/ui-kit/dialog.js', 'node_modules/ui-kit/util.js')
        .imports('node_modules/ui-kit/dialog.js', 'node_modules/ui-kit/overlay.js')
        .graph();

    it('shares only the modules both imports reach when they pull different exports from one package', () => {
        expect(sizes(importImpact(graph, ['src/page.ts'], 'node_modules/ui-kit/dialog.js'))).toEqual({ bundled: 800, exclusive: 700, shared: 100, lazy: 0 });
    });

    it('takes the cost of a barrel import from the module graph rather than from the package name', () => {
        const barrel = importImpact(graph, ['src/settings.ts'], 'node_modules/ui-kit/index.js');

        expect(sizes(barrel)).toEqual({ bundled: 570, exclusive: 170, shared: 400, lazy: 0 });
        expect(barrel.packages).toEqual([{ key: 'node_modules/ui-kit', name: 'ui-kit', version: '2.0.0', bytes: 570 }]);
        expect(sizes(importImpact(graph, ['src/page.ts'], 'node_modules/ui-kit/button.js'))).toEqual({ bundled: 400, exclusive: 0, shared: 400, lazy: 0 });
    });
});

describe('importImpact on lazy imports', () => {
    const graph = fixture()
        .module('src/main.ts', 10, { entry: true })
        .module('src/router.ts', 100)
        .module('src/util.ts', 50)
        .module('src/pages/About.ts', 300, { chunk: 'dist/About.js' })
        .module('src/pages/about-data.ts', 200, { chunk: 'dist/About.js' })
        .imports('src/main.ts', 'src/router.ts')
        .imports('src/router.ts', 'src/util.ts')
        .imports('src/router.ts', 'src/pages/About.ts', { kind: 'dynamic' })
        .imports('src/pages/About.ts', 'src/pages/about-data.ts')
        .imports('src/pages/About.ts', 'src/util.ts')
        .graph();

    it('reports what an import loads lazily apart from what it bundles, counting a module reached both ways as bundled', () => {
        expect(importImpact(graph, ['src/main.ts'], 'src/router.ts')).toMatchObject({ bundledBytes: 150, lazyBytes: 500, moduleCount: 2 });
    });

    it('measures the lazily loaded module itself as bundled from its own point of view', () => {
        expect(sizes(importImpact(graph, ['src/router.ts'], 'src/pages/About.ts'))).toEqual({ bundled: 550, exclusive: 500, shared: 50, lazy: 0 });
    });
});

describe('importImpact details', () => {
    it('terminates on circular imports and counts each module once', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/a.ts', 100)
            .module('src/b.ts', 200)
            .imports('src/main.ts', 'src/a.ts')
            .imports('src/a.ts', 'src/b.ts')
            .imports('src/b.ts', 'src/a.ts')
            .graph();

        expect(sizes(importImpact(graph, ['src/main.ts'], 'src/a.ts'))).toEqual({ bundled: 300, exclusive: 300, shared: 0, lazy: 0 });
        expect(importImpact(graph, ['src/main.ts'], 'src/a.ts').moduleCount).toBe(2);
    });

    it('counts tree-shaken modules but leaves them out of the retained modules and the precision', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/icons.ts', 0)
            .module('src/icons/all.ts', 0)
            .imports('src/main.ts', 'src/icons.ts')
            .imports('src/icons.ts', 'src/icons/all.ts')
            .graph();

        const impact = importImpact(graph, ['src/main.ts'], 'src/icons.ts');

        expect(impact).toMatchObject({ bundledBytes: 0, moduleCount: 2, retainedModuleCount: 0, exclusiveModuleCount: 0, packages: [] });
        expect(impact).not.toHaveProperty('precision');
    });

    it('reports the least precise measurement among the retained modules', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/a.ts', 100, { precision: 'sourcemap-estimate' })
            .module('src/b.ts', 100, { precision: 'rendered-length' })
            .module('src/c.ts', 100, { precision: 'bundler-reported' })
            .imports('src/main.ts', 'src/a.ts')
            .imports('src/a.ts', 'src/b.ts')
            .imports('src/a.ts', 'src/c.ts')
            .graph();

        expect(importImpact(graph, ['src/main.ts'], 'src/a.ts').precision).toBe('rendered-length');
    });

    it('breaks the cost down by package instance, largest first', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/table.ts', 100)
            .module('node_modules/lodash/sortBy.js', 300, inPackage('lodash', '4.17.21'))
            .module('node_modules/lodash/_baseSortBy.js', 200, inPackage('lodash', '4.17.21'))
            .module('node_modules/ms/index.js', 50, inPackage('ms'))
            .imports('src/main.ts', 'src/table.ts')
            .imports('src/table.ts', 'node_modules/lodash/sortBy.js')
            .imports('src/table.ts', 'node_modules/ms/index.js')
            .imports('node_modules/lodash/sortBy.js', 'node_modules/lodash/_baseSortBy.js')
            .graph();

        expect(importImpact(graph, ['src/main.ts'], 'src/table.ts').packages).toEqual([
            { key: 'node_modules/lodash', name: 'lodash', version: '4.17.21', bytes: 500 },
            { key: undefined, name: undefined, bytes: 100 },
            { key: 'node_modules/ms', name: 'ms', bytes: 50 },
        ]);
    });

    it('reuses the result for the same importers in any order', () => {
        const graph = fixture()
            .module('src/a.ts', 10, { entry: true })
            .module('src/b.ts', 10, { entry: true })
            .module('src/x.ts', 100)
            .imports('src/a.ts', 'src/x.ts')
            .imports('src/b.ts', 'src/x.ts')
            .graph();

        const first = importImpact(graph, ['src/a.ts', 'src/b.ts'], 'src/x.ts');

        expect(importImpact(graph, ['src/b.ts', 'src/a.ts'], 'src/x.ts')).toBe(first);
        expect(importImpact(graph, ['src/a.ts'], 'src/x.ts')).not.toBe(first);
        expect(importImpact(graph, ['src/a.ts'], 'src/x.ts').exclusiveBytes).toBe(0);
        expect(first.exclusiveBytes).toBe(100);
    });
});
