import { describe, expect, it } from 'vitest';

import { BUILD_CONTEXT, dynamicImport, externalImport, importOf, input, metafile, output, statement } from './support/esbuild';
import { at, rollupBuild, rollupChunk, rollupModule } from './support/rollup';
import { fixture, inPackage } from './support/snapshot';
import { normalizeEsbuildMetafile } from '../../core/adapters/esbuild';
import { normalizeRollupBuild } from '../../core/adapters/rollup';
import { attributeImport, locateDocument } from '../../core/attribution/attribute';
import { matchImport } from '../../core/attribution/match';
import { BuildGraph } from '../../core/graph/buildGraph';

import type { DocumentLocation, ImportCost, ImportQuery } from '../../core/attribution/attribute';
import type { MatchKindHint } from '../../core/attribution/match';

type QuerySpec = Partial<ImportQuery> & Pick<ImportQuery, 'specifier'>;

function locate(graph: BuildGraph, documentPath: string): DocumentLocation {
    const location = locateDocument(graph, documentPath);
    if (!location) {
        throw new Error(`the build has no module at "${documentPath}"`);
    }
    return location;
}

function attribute(location: DocumentLocation, query: QuerySpec): ImportCost {
    return attributeImport(location, { kind: 'static', typeOnly: false, ...query });
}

function bundledBytes(cost: ImportCost): number | undefined {
    return cost.status === 'bundled' || cost.status === 'tree-shaken' ? cost.impact.bundledBytes : undefined;
}

function resolvedModuleOf(cost: ImportCost): string | undefined {
    return cost.status === 'bundled' || cost.status === 'tree-shaken' ? cost.module.id : undefined;
}

describe('locateDocument', () => {
    const graph = fixture()
        .module('src/App.vue', 10)
        .module('src/App.vue?vue&type=script&setup=true&lang.ts', 10, { path: 'src/App.vue' })
        .graph();

    it('returns every module built from the document', () => {
        expect(locateDocument(graph, 'src/App.vue')).toEqual({
            graph,
            documentPath: 'src/App.vue',
            importerIds: ['src/App.vue', 'src/App.vue?vue&type=script&setup=true&lang.ts'],
        });
    });

    it('returns nothing for a document the build does not contain', () => {
        expect(locateDocument(graph, 'src/Other.vue')).toBeUndefined();
    });
});

describe('matchImport', () => {
    const graph = fixture()
        .module('src/main.ts', 10, { entry: true })
        .module('src/pages/home.ts', 10)
        .module('src/util.ts', 10)
        .module('src/page.ts', 10)
        .module('src/style.css', 10)
        .module('src/components/index.ts', 10)
        .module('src/shared/format.ts', 10)
        .module('src/Button.tsx', 10)
        .module('src/worker.mts', 10)
        .module('src/App.vue', 10)
        .module('src/components/Card.vue', 10)
        .module('src/utils/date.ts', 10)
        .module('src/lib/stores.ts', 10)
        .module('src/internal/db/index.ts', 10)
        .module('node_modules/lodash-es/lodash.js', 10, inPackage('lodash-es'))
        .module('node_modules/lodash-es/debounce.js', 10, inPackage('lodash-es'))
        .module('node_modules/date-fns/esm/index.js', 10, inPackage('date-fns'))
        .module('node_modules/date-fns/esm/locale/index.js', 10, inPackage('date-fns'))
        .module('node_modules/date-fns/esm/_lib/format/longFormatters.js', 10, inPackage('date-fns'))
        .module('node_modules/.pnpm/@vue+shared@3.5.13/node_modules/@vue/shared/dist/shared.esm-bundler.js', 10, inPackage('@vue/shared', '3.5.13', 'node_modules/.pnpm/@vue+shared@3.5.13/node_modules/@vue/shared'))
        .imports('src/main.ts', 'src/util.ts', { specifier: './util' })
        .imports('src/main.ts', 'src/page.ts', { specifier: './page' })
        .imports('src/main.ts', 'src/page.ts', { specifier: './page', kind: 'dynamic' })
        .imports('src/main.ts', 'src/style.css', { specifier: './style.css', kind: 'css' })
        .imports('src/pages/home.ts', 'src/util.ts')
        .imports('src/pages/home.ts', 'src/components/index.ts')
        .imports('src/pages/home.ts', 'src/shared/format.ts')
        .imports('src/pages/home.ts', 'src/Button.tsx')
        .imports('src/pages/home.ts', 'src/worker.mts', { kind: 'dynamic' })
        .imports('src/pages/home.ts', 'src/App.vue')
        .imports('src/pages/home.ts', 'src/components/Card.vue')
        .imports('src/pages/home.ts', 'src/utils/date.ts')
        .imports('src/pages/home.ts', 'src/lib/stores.ts')
        .imports('src/pages/home.ts', 'src/internal/db/index.ts')
        .imports('src/pages/home.ts', 'src/style.css', { kind: 'css' })
        .imports('src/pages/home.ts', 'node_modules/lodash-es/lodash.js')
        .imports('src/pages/home.ts', 'node_modules/lodash-es/debounce.js')
        .imports('src/pages/home.ts', 'node_modules/date-fns/esm/_lib/format/longFormatters.js')
        .imports('src/pages/home.ts', 'node_modules/date-fns/esm/index.js')
        .imports('src/pages/home.ts', 'node_modules/date-fns/esm/locale/index.js')
        .imports('src/pages/home.ts', 'node_modules/.pnpm/@vue+shared@3.5.13/node_modules/@vue/shared/dist/shared.esm-bundler.js')
        .external('src/pages/home.ts', 'lodash', { retained: true })
        .graph();

    const match = (specifier: string, hint?: MatchKindHint, documentPath = 'src/pages/home.ts', importers = [documentPath]) =>
        matchImport(graph, importers, documentPath, specifier, hint);
    const target = (specifier: string, hint?: MatchKindHint, documentPath?: string) => {
        const found = match(specifier, hint, documentPath);
        return found && [found.edge.resolvedModule ?? found.edge.specifier, found.confidence];
    };

    it('returns nothing when the document imports nothing in the build', () => {
        expect(match('./util', 'static', 'src/util.ts')).toBeUndefined();
    });

    it('matches the specifier the bundler recorded exactly', () => {
        expect(target('./util', 'static', 'src/main.ts')).toEqual(['src/util.ts', 'exact']);
    });

    it('prefers the edge of the same kind when a specifier is imported in several ways', () => {
        expect(match('./page', 'dynamic', 'src/main.ts')?.edge.kind).toBe('dynamic');
        expect(match('./page', 'static', 'src/main.ts')?.edge.kind).toBe('static');
        expect(match('./page', 'require', 'src/main.ts')?.edge.kind).toBe('static');
        expect(match('./page', undefined, 'src/main.ts')?.edge.kind).toBe('static');
    });

    it('counts a CSS edge as a static import', () => {
        expect(match('./style.css', 'static', 'src/main.ts')?.edge.kind).toBe('css');
    });

    it.each([
        ['../util', 'src/util.ts'],
        ['../util.js', 'src/util.ts'],
        ['../components', 'src/components/index.ts'],
        ['../components/', 'src/components/index.ts'],
        ['../shared/format', 'src/shared/format.ts'],
        ['../Button.jsx', 'src/Button.tsx'],
        ['../worker.mjs', 'src/worker.mts'],
        ['../App.vue', 'src/App.vue'],
        ['../style.css', 'src/style.css'],
        ['/src/utils/date', 'src/utils/date.ts'],
    ])('resolves the relative import %s to %s by probing source extensions', (specifier, resolved) => {
        expect(target(specifier)).toEqual([resolved, 'resolved']);
    });

    it('does not guess a relative import that matches no module', () => {
        expect(match('../missing')).toBeUndefined();
        expect(match('./util')).toBeUndefined();
    });

    it('matches a bare import to a bundled module of that package', () => {
        expect(target('@vue/shared')).toEqual(['node_modules/.pnpm/@vue+shared@3.5.13/node_modules/@vue/shared/dist/shared.esm-bundler.js', 'resolved']);
    });

    it('picks the module whose path best fits the subpath of a deep import', () => {
        expect(target('lodash-es/debounce')).toEqual(['node_modules/lodash-es/debounce.js', 'resolved']);
        expect(target('lodash-es/debounce.js')).toEqual(['node_modules/lodash-es/debounce.js', 'resolved']);
        expect(target('date-fns/locale')).toEqual(['node_modules/date-fns/esm/locale/index.js', 'resolved']);
    });

    it('picks the shallowest index module for a root import', () => {
        expect(target('date-fns')).toEqual(['node_modules/date-fns/esm/index.js', 'resolved']);
    });

    it('matches an import of an external package by package name', () => {
        expect(target('lodash/fp')).toEqual(['lodash', 'resolved']);
    });

    it.each([
        ['@/components/Card.vue', 'src/components/Card.vue'],
        ['~/utils/date', 'src/utils/date.ts'],
        ['$lib/stores', 'src/lib/stores.ts'],
        ['#internal/db', 'src/internal/db/index.ts'],
        ['@@/utils/date.js', 'src/utils/date.ts'],
        ['components/Card', 'src/components/Card.vue'],
    ])('matches the path alias %s by its tail to %s', (specifier, resolved) => {
        expect(target(specifier)).toEqual([resolved, 'heuristic']);
    });

    it('does not guess an alias whose tail fits more than one module', () => {
        const ambiguous = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/utils/index.ts', 10)
            .module('packages/core/utils.ts', 10)
            .imports('src/main.ts', 'src/utils/index.ts')
            .imports('src/main.ts', 'packages/core/utils.ts')
            .graph();

        expect(matchImport(ambiguous, ['src/main.ts'], 'src/main.ts', '@/utils')).toBeUndefined();
    });

    it('does not guess a bare package the build does not contain', () => {
        expect(match('react')).toBeUndefined();
        expect(match('react-dom/client')).toBeUndefined();
        expect(match('node:fs')).toBeUndefined();
    });
});

const EXTENSION_HOST = new BuildGraph(normalizeEsbuildMetafile(metafile(
    {
        'src/extension.ts': input(4000, [
            externalImport('vscode'),
            externalImport('typescript'),
            externalImport('./shapes'),
            statement('src/commands.ts', './commands'),
            statement('src/unused.ts', './unused'),
            statement('src/polyfill.ts', './polyfill'),
            dynamicImport('src/heavy.ts', './heavy'),
            statement('node_modules/lodash-es/debounce.js', 'lodash-es/debounce'),
            importOf('src/legacy.js', 'require-call', './legacy'),
            statement('src/api.ts', './api'),
        ]),
        'src/commands.ts': input(800, [statement('node_modules/lodash-es/debounce.js', 'lodash-es/debounce')]),
        'src/unused.ts': input(300),
        'src/polyfill.ts': input(100),
        'src/heavy.ts': input(5000, [statement('src/heavy-dep.ts', './heavy-dep')]),
        'src/heavy-dep.ts': input(1000),
        'node_modules/lodash-es/debounce.js': input(2000),
        'src/legacy.js': input(400),
        'src/api.ts': input(250),
    },
    {
        'dist/extension.js': output({
            'src/extension.ts': 900,
            'src/commands.ts': 500,
            'src/unused.ts': 0,
            'src/polyfill.ts': 60,
            'node_modules/lodash-es/debounce.js': 700,
            'src/legacy.js': 250,
            'src/api.ts': 120,
        }, {
            entryPoint: 'src/extension.ts',
            imports: [externalImport('vscode', 'require-call'), importOf('dist/heavy-7Q.js', 'dynamic-import')],
        }),
        'dist/heavy-7Q.js': output({ 'src/heavy.ts': 3000, 'src/heavy-dep.ts': 600 }, { entryPoint: 'src/heavy.ts' }),
    },
), BUILD_CONTEXT));

describe('attributeImport on an esbuild build', () => {
    const location = locate(EXTENSION_HOST, 'src/extension.ts');

    it('reports a type-only import as type-only without consulting the build', () => {
        expect(attribute(location, { specifier: './commands', typeOnly: true })).toEqual({ status: 'type-only' });
    });

    it('reports a named import with what it adds to the bundle', () => {
        const cost = attribute(location, { specifier: './commands', hasValueUsage: true });

        expect(cost).toMatchObject({
            status: 'bundled',
            lazy: false,
            match: { confidence: 'exact', edge: { resolvedModule: 'src/commands.ts' } },
            module: { id: 'src/commands.ts' },
            impact: { bundledBytes: 1200, exclusiveBytes: 500, sharedBytes: 700, precision: 'bundler-reported' },
        });
    });

    it('reports an import whose module the bundler tree-shook as tree-shaken', () => {
        const cost = attribute(location, { specifier: './unused', hasValueUsage: false });

        expect(cost.status).toBe('tree-shaken');
        expect(bundledBytes(cost)).toBe(0);
    });

    it('reports an unused TypeScript import that esbuild left unresolved as elided', () => {
        expect(attribute(location, { specifier: './shapes', hasValueUsage: false })).toEqual({
            status: 'elided',
            match: { confidence: 'exact', edge: { importer: 'src/extension.ts', specifier: './shapes', kind: 'static', external: true, retained: false } },
        });
    });

    it('reports an external import the output still contains as external', () => {
        expect(attribute(location, { specifier: 'vscode', hasValueUsage: true })).toEqual({
            status: 'external',
            specifier: 'vscode',
            match: { confidence: 'exact', edge: { importer: 'src/extension.ts', specifier: 'vscode', kind: 'static', external: true, retained: true } },
        });
    });

    it('reports an external import the output no longer contains as elided', () => {
        expect(attribute(location, { specifier: 'typescript' }).status).toBe('elided');
    });

    it('reports a side-effect import of a bundled module as bundled', () => {
        const cost = attribute(location, { specifier: './polyfill', sideEffectOnly: true });

        expect(cost.status).toBe('bundled');
        expect(bundledBytes(cost)).toBe(60);
    });

    it('reports a dynamic import as lazy, with the bytes of the chunk it loads', () => {
        const cost = attribute(location, { specifier: './heavy', kind: 'dynamic' });

        expect(cost).toMatchObject({ status: 'bundled', lazy: true, impact: { bundledBytes: 3600, exclusiveBytes: 3600, lazyBytes: 0 } });
    });

    it('matches require calls and re-exports through their own kinds', () => {
        expect(resolvedModuleOf(attribute(location, { specifier: './legacy', kind: 'require' }))).toBe('src/legacy.js');
        expect(resolvedModuleOf(attribute(location, { specifier: './api', kind: 're-export' }))).toBe('src/api.ts');
    });

    it('attaches the package instance of a package import', () => {
        const cost = attribute(location, { specifier: 'lodash-es/debounce' });

        expect(cost).toMatchObject({ status: 'bundled', package: { name: 'lodash-es', root: 'node_modules/lodash-es', bytes: 700 } });
        expect(cost).not.toHaveProperty('duplicate');
    });

    it('reports an import the build has no record of as unresolved', () => {
        expect(attribute(location, { specifier: './added-after-build' })).toEqual({ status: 'unresolved' });
        expect(attribute(location, { specifier: './added-after-build', hasValueUsage: true })).toEqual({ status: 'unresolved' });
    });

    it('reports an unrecorded import without value usage as elided', () => {
        expect(attribute(location, { specifier: './only-types', hasValueUsage: false })).toEqual({ status: 'elided' });
    });

    it('keeps unrecorded side-effect and dynamic imports unresolved even without value usage', () => {
        expect(attribute(location, { specifier: './gone', hasValueUsage: false, sideEffectOnly: true })).toEqual({ status: 'unresolved' });
        expect(attribute(location, { specifier: './gone', hasValueUsage: false, kind: 'dynamic' })).toEqual({ status: 'unresolved' });
    });
});

describe('attributeImport details', () => {
    it('reports an import whose module only loads others lazily as bundled', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/routes.ts', 0)
            .module('src/pages/About.ts', 900, { chunk: 'dist/About.js' })
            .imports('src/main.ts', 'src/routes.ts', { specifier: './routes' })
            .imports('src/routes.ts', 'src/pages/About.ts', { kind: 'dynamic' })
            .graph();

        expect(attribute(locate(graph, 'src/main.ts'), { specifier: './routes' }))
            .toMatchObject({ status: 'bundled', lazy: false, impact: { bundledBytes: 0, lazyBytes: 900 } });
    });

    it('reports a package bundled in several versions as a duplicate', () => {
        const legacy = inPackage('lodash', '3.10.1', 'node_modules/legacy-widget/node_modules/lodash');
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('node_modules/lodash/lodash.js', 7000, inPackage('lodash', '4.17.21'))
            .module('node_modules/legacy-widget/index.js', 100, inPackage('legacy-widget', '1.0.0'))
            .module('node_modules/legacy-widget/node_modules/lodash/index.js', 5000, legacy)
            .imports('src/main.ts', 'node_modules/lodash/lodash.js', { specifier: 'lodash' })
            .imports('src/main.ts', 'node_modules/legacy-widget/index.js', { specifier: 'legacy-widget' })
            .imports('node_modules/legacy-widget/index.js', 'node_modules/legacy-widget/node_modules/lodash/index.js', { specifier: 'lodash' })
            .graph();

        const cost = attribute(locate(graph, 'src/main.ts'), { specifier: 'lodash' });

        expect(cost).toMatchObject({ status: 'bundled', package: { version: '4.17.21' } });
        expect(cost.status === 'bundled' && cost.duplicate?.instances.map(instance => instance.version)).toEqual(['4.17.21', '3.10.1']);
        expect(cost.status === 'bundled' && cost.duplicate?.bytes).toBe(12_000);
    });

    it('reports an external edge without retained information as external', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .external('src/main.ts', 'react')
            .graph();

        expect(attribute(locate(graph, 'src/main.ts'), { specifier: 'react/jsx-runtime' })).toMatchObject({ status: 'external', specifier: 'react' });
    });
});

describe('attributeImport on a Vite build', () => {
    const script = at('src/App.vue?vue&type=script&setup=true&lang.ts');
    const graph = new BuildGraph(normalizeRollupBuild(rollupBuild({
        modules: [
            rollupModule(at('src/main.ts'), { isEntry: true, importedIds: [at('src/App.vue'), at('src/icon.svg?raw'), 'vue'] }),
            rollupModule(at('src/App.vue'), { importedIds: [script] }),
            rollupModule(script, {
                importedIds: [at('src/components/Hello.vue'), at('src/composables/useCounter.ts'), 'vue', 'lodash-es'],
                dynamicallyImportedIds: [at('src/pages/About.vue')],
            }),
            rollupModule(at('src/components/Hello.vue')),
            rollupModule(at('src/composables/useCounter.ts')),
            rollupModule(at('src/pages/About.vue')),
            rollupModule(at('src/icon.svg?raw')),
            rollupModule('vue', { isExternal: true }),
            rollupModule('lodash-es', { isExternal: true }),
        ],
        chunks: [
            rollupChunk('assets/index.js', {
                isEntry: true,
                facadeModuleId: at('src/main.ts'),
                modules: {
                    [at('src/main.ts')]: 100,
                    [at('src/App.vue')]: 50,
                    [script]: 600,
                    [at('src/components/Hello.vue')]: 300,
                    [at('src/composables/useCounter.ts')]: 80,
                    [at('src/icon.svg?raw')]: 450,
                },
                imports: ['vue'],
                dynamicImports: ['assets/About.js'],
            }),
            rollupChunk('assets/About.js', { isDynamicEntry: true, facadeModuleId: at('src/pages/About.vue'), modules: { [at('src/pages/About.vue')]: 400 } }),
        ],
    }), BUILD_CONTEXT));
    const app = locate(graph, 'src/App.vue');
    const main = locate(graph, 'src/main.ts');

    it('finds the imports of a single-file component through all of its modules', () => {
        expect(app.importerIds).toEqual(['src/App.vue', 'src/App.vue?vue&type=script&setup=true&lang.ts']);
        expect(attribute(app, { specifier: './components/Hello.vue' })).toMatchObject({ status: 'bundled', match: { confidence: 'resolved' }, impact: { bundledBytes: 300 } });
    });

    it('matches a path alias by its tail', () => {
        expect(attribute(app, { specifier: '@/composables/useCounter' })).toMatchObject({ status: 'bundled', match: { confidence: 'heuristic' }, impact: { bundledBytes: 80 } });
    });

    it('tells a retained external from one the build dropped', () => {
        expect(attribute(app, { specifier: 'vue' }).status).toBe('external');
        expect(attribute(app, { specifier: 'lodash-es' }).status).toBe('elided');
    });

    it('reports a lazily loaded page as lazy', () => {
        expect(attribute(app, { specifier: './pages/About.vue', kind: 'dynamic' }))
            .toMatchObject({ status: 'bundled', lazy: true, impact: { bundledBytes: 400, precision: 'rendered-length' } });
    });

    it('matches a relative import with a query to the module built from it', () => {
        expect(attribute(main, { specifier: './icon.svg?raw' })).toMatchObject({ status: 'bundled', module: { id: 'src/icon.svg?raw' }, impact: { bundledBytes: 450 } });
    });
});
