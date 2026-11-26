import { describe, expect, it } from 'vitest';

import { fixture, inPackage } from './support/snapshot';
import { attributeImport, locateDocument } from '../../core/attribution/attribute';
import { traceBarrel } from '../../core/attribution/barrels';
import { importImpact, scopedImpact, wholeModule } from '../../core/graph/impact';

import type { BarrelContext, DocumentLocation, ImportCost, ImportQuery } from '../../core/attribution/attribute';
import type { ExportResolver, ModuleExports } from '../../core/attribution/barrels';
import type { BuildGraph } from '../../core/graph/buildGraph';
import type { ImportImpact } from '../../core/graph/impact';

const UI_KIT = inPackage('ui-kit', '2.0.0');

type EsmSpec = Partial<Omit<Extract<ModuleExports, { kind: 'esm' }>, 'kind'>>;

function esm(spec: EsmSpec = {}): ModuleExports {
    return { kind: 'esm', local: [], reExports: [], exportAll: [], ownImports: [], ...spec };
}

function reExport(name: string, specifier: string, imported = name): { name: string; imported: string; specifier: string } {
    return { name, imported, specifier };
}

function resolver(table: Readonly<Record<string, ModuleExports>>): ExportResolver {
    return id => table[id];
}

function sizes(impact: ImportImpact): Record<string, number> {
    return { bundled: impact.bundledBytes, exclusive: impact.exclusiveBytes, shared: impact.sharedBytes, lazy: impact.lazyBytes };
}

function locate(graph: BuildGraph, documentPath: string): DocumentLocation {
    const location = locateDocument(graph, documentPath);
    if (!location) {
        throw new Error(`the build has no module at "${documentPath}"`);
    }
    return location;
}

function impactOf(cost: ImportCost): ImportImpact | undefined {
    return cost.status === 'bundled' || cost.status === 'tree-shaken' ? cost.impact : undefined;
}

const KIT = 'node_modules/ui-kit/index.js';
const BUTTON = 'node_modules/ui-kit/button.js';
const DIALOG = 'node_modules/ui-kit/dialog.js';
const OVERLAY = 'node_modules/ui-kit/overlay.js';
const TABS = 'node_modules/ui-kit/tabs.js';
const UTIL = 'node_modules/ui-kit/util.js';
const STYLES = 'node_modules/ui-kit/styles.css';

function uiKit(): BuildGraph {
    return fixture()
        .module('src/main.ts', 10, { entry: true })
        .module('src/page.ts', 10)
        .module('src/settings.ts', 10)
        .module(KIT, 20, UI_KIT)
        .module(BUTTON, 300, UI_KIT)
        .module(DIALOG, 500, UI_KIT)
        .module(OVERLAY, 200, UI_KIT)
        .module(TABS, 150, UI_KIT)
        .module(UTIL, 100, UI_KIT)
        .module(STYLES, 40, { ...UI_KIT, chunk: 'dist/main.css' })
        .imports('src/main.ts', 'src/page.ts', { specifier: './page' })
        .imports('src/main.ts', 'src/settings.ts', { specifier: './settings' })
        .imports('src/page.ts', KIT, { specifier: 'ui-kit' })
        .imports(KIT, STYLES, { specifier: './styles.css', kind: 'css' })
        .imports(KIT, BUTTON, { specifier: './button.js' })
        .imports(KIT, DIALOG, { specifier: './dialog.js' })
        .imports(KIT, TABS, { specifier: './tabs.js' })
        .imports(BUTTON, UTIL, { specifier: './util.js' })
        .imports(DIALOG, UTIL, { specifier: './util.js' })
        .imports(DIALOG, OVERLAY, { specifier: './overlay.js' })
        .graph();
}

const UI_KIT_EXPORTS = resolver({
    [KIT]: esm({
        reExports: [reExport('Button', './button.js', 'default'), reExport('Dialog', './dialog.js')],
        exportAll: ['./tabs.js'],
        ownImports: ['./styles.css'],
    }),
    [BUTTON]: esm({ local: ['default'] }),
    [DIALOG]: esm({ local: ['Dialog', 'useDialog'] }),
    [TABS]: esm({ local: ['Tabs'] }),
});

describe('traceBarrel', () => {
    const graph = uiKit();

    it('follows a named re-export to the module that defines the name', () => {
        expect(traceBarrel(graph, KIT, ['Dialog'], UI_KIT_EXPORTS)).toEqual({
            moduleId: KIT,
            names: ['Dialog'],
            definers: [DIALOG],
            passThrough: [KIT],
            eagerRoots: [DIALOG, STYLES],
            lazyRoots: [],
        });
    });

    it('follows a re-exported default under its new name', () => {
        expect(traceBarrel(graph, KIT, ['Button'], UI_KIT_EXPORTS)?.definers).toEqual([BUTTON]);
    });

    it('finds a name among the modules the barrel passes every export of on', () => {
        expect(traceBarrel(graph, KIT, ['Tabs'], UI_KIT_EXPORTS)?.definers).toEqual([TABS]);
    });

    it('collects the definitions of several names once each', () => {
        expect(traceBarrel(graph, KIT, ['Dialog', 'Button', 'Dialog'], UI_KIT_EXPORTS)).toMatchObject({
            names: ['Dialog', 'Button'],
            definers: [BUTTON, DIALOG],
        });
    });

    it('keeps what the barrel imports for itself, and drops what it only re-exports for other names', () => {
        const trace = traceBarrel(graph, KIT, ['Button'], UI_KIT_EXPORTS);

        expect(trace?.eagerRoots).toEqual([BUTTON, STYLES]);
        expect(trace?.eagerRoots).not.toContain(TABS);
    });

    it.each([
        ['no names', [] as string[]],
        ['a name the barrel does not export', ['Missing']],
        ['a default the barrel does not have, which export * never passes on', ['default']],
    ])('does not narrow an import of %s', (_, names) => {
        expect(traceBarrel(graph, KIT, names, UI_KIT_EXPORTS)).toBeUndefined();
    });

    it('does not narrow when the barrel defines one of the names itself', () => {
        const exportsOf = resolver({ [KIT]: esm({ local: ['VERSION'], reExports: [reExport('Dialog', './dialog.js')] }), [DIALOG]: esm({ local: ['Dialog'] }) });

        expect(traceBarrel(graph, KIT, ['Dialog'], exportsOf)).toBeDefined();
        expect(traceBarrel(graph, KIT, ['Dialog', 'VERSION'], exportsOf)).toBeUndefined();
    });

    it('does not narrow a barrel whose exports are unknown or not loaded', () => {
        expect(traceBarrel(graph, KIT, ['Dialog'], resolver({ [KIT]: { kind: 'unknown' } }))).toBeUndefined();
        expect(traceBarrel(graph, KIT, ['Dialog'], resolver({}))).toBeUndefined();
    });

    it('does not narrow through a re-export whose module is not in the build', () => {
        const exportsOf = resolver({ [KIT]: esm({ reExports: [reExport('Dialog', './dialog.js'), reExport('Gone', './gone.js')] }) });

        expect(traceBarrel(graph, KIT, ['Gone'], exportsOf)).toBeUndefined();
    });

    it('stops at a re-exported module whose own exports are unknown or not loaded, counting all of it', () => {
        const exportsOf = resolver({ [KIT]: esm({ reExports: [reExport('Dialog', './dialog.js')] }), [DIALOG]: { kind: 'unknown' } });

        expect(traceBarrel(graph, KIT, ['Dialog'], exportsOf)?.definers).toEqual([DIALOG]);
        expect(traceBarrel(graph, KIT, ['Dialog'], resolver({ [KIT]: esm({ reExports: [reExport('Dialog', './dialog.js')] }) }))?.definers).toEqual([DIALOG]);
    });

    it('treats a namespace re-export as the whole module it names', () => {
        const exportsOf = resolver({ [KIT]: esm({ reExports: [reExport('dialogs', './dialog.js', '*')] }), [DIALOG]: esm({ local: ['Dialog'] }) });

        expect(traceBarrel(graph, KIT, ['dialogs'], exportsOf)?.definers).toEqual([DIALOG]);
    });

    it('leaves a module with a single import alone, since narrowing it could not remove anything', () => {
        const single = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/index.ts', 0)
            .module('src/impl.ts', 100)
            .imports('src/main.ts', 'src/index.ts', { specifier: './index' })
            .imports('src/index.ts', 'src/impl.ts', { specifier: './impl' })
            .graph();

        expect(traceBarrel(single, 'src/index.ts', ['impl'], resolver({ 'src/index.ts': esm({ exportAll: ['./impl'] }) }))).toBeUndefined();
    });

    it('narrows through a facade that only passes on a barrel', () => {
        const facade = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/facade.ts', 0)
            .module('src/barrel.ts', 0)
            .module('src/a.ts', 100)
            .module('src/b.ts', 200)
            .imports('src/main.ts', 'src/facade.ts', { specifier: './facade' })
            .imports('src/facade.ts', 'src/barrel.ts', { specifier: './barrel' })
            .imports('src/barrel.ts', 'src/a.ts', { specifier: './a' })
            .imports('src/barrel.ts', 'src/b.ts', { specifier: './b' })
            .graph();
        const exportsOf = resolver({
            'src/facade.ts': esm({ exportAll: ['./barrel'] }),
            'src/barrel.ts': esm({ exportAll: ['./a', './b'] }),
            'src/a.ts': esm({ local: ['a'] }),
            'src/b.ts': esm({ local: ['b'] }),
        });

        expect(traceBarrel(facade, 'src/facade.ts', ['a'], exportsOf)).toMatchObject({
            definers: ['src/a.ts'],
            passThrough: ['src/facade.ts', 'src/barrel.ts'],
            eagerRoots: ['src/a.ts'],
        });
    });

    it('follows re-exports through nested barrels, and imports that are only exported again', () => {
        const nested = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/index.ts', 0)
            .module('src/forms/index.ts', 0)
            .module('src/forms/Input.ts', 400)
            .module('src/forms/Select.ts', 600)
            .module('src/Card.ts', 300)
            .imports('src/main.ts', 'src/index.ts', { specifier: './index' })
            .imports('src/index.ts', 'src/forms/index.ts', { specifier: './forms' })
            .imports('src/index.ts', 'src/Card.ts', { specifier: './Card' })
            .imports('src/forms/index.ts', 'src/forms/Input.ts', { specifier: './Input' })
            .imports('src/forms/index.ts', 'src/forms/Select.ts', { specifier: './Select' })
            .graph();
        const exportsOf = resolver({
            'src/index.ts': esm({ exportAll: ['./forms'], reExports: [reExport('Card', './Card', 'default')] }),
            'src/forms/index.ts': esm({ reExports: [reExport('Input', './Input', 'default'), reExport('Select', './Select', 'default')] }),
            'src/forms/Input.ts': esm({ local: ['default'] }),
            'src/forms/Select.ts': esm({ local: ['default'] }),
        });

        expect(traceBarrel(nested, 'src/index.ts', ['Input'], exportsOf)).toMatchObject({
            definers: ['src/forms/Input.ts'],
            passThrough: ['src/index.ts', 'src/forms/index.ts'],
            eagerRoots: ['src/forms/Input.ts'],
        });
    });

    it('counts every module a name could come from when export * leads to modules it cannot read', () => {
        const exportsOf = resolver({ [KIT]: esm({ exportAll: ['./tabs.js', './dialog.js'] }), [TABS]: { kind: 'unknown' }, [DIALOG]: esm({ local: ['Dialog'] }) });

        expect(traceBarrel(graph, KIT, ['Dialog'], exportsOf)?.definers).toEqual([DIALOG, TABS]);
    });

    it('terminates on barrels that pass each other\'s exports on in a cycle', () => {
        const cyclic = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/a/index.ts', 0)
            .module('src/b/index.ts', 0)
            .module('src/a/one.ts', 100)
            .module('src/b/two.ts', 100)
            .imports('src/main.ts', 'src/a/index.ts', { specifier: './a' })
            .imports('src/a/index.ts', 'src/b/index.ts', { specifier: '../b' })
            .imports('src/a/index.ts', 'src/a/one.ts', { specifier: './one' })
            .imports('src/b/index.ts', 'src/a/index.ts', { specifier: '../a' })
            .imports('src/b/index.ts', 'src/b/two.ts', { specifier: './two' })
            .graph();
        const exportsOf = resolver({
            'src/a/index.ts': esm({ exportAll: ['../b', './one'] }),
            'src/b/index.ts': esm({ exportAll: ['../a', './two'] }),
            'src/a/one.ts': esm({ local: ['one'] }),
            'src/b/two.ts': esm({ local: ['two'] }),
        });

        expect(traceBarrel(cyclic, 'src/a/index.ts', ['two'], exportsOf)?.definers).toEqual(['src/b/two.ts']);
        expect(traceBarrel(cyclic, 'src/a/index.ts', ['three'], exportsOf)).toBeUndefined();
    });

    it('gives up on a re-export chain deeper than it follows', () => {
        let deep = fixture().module('src/main.ts', 10, { entry: true }).module('src/end.ts', 100).module('src/other.ts', 100);
        const table: Record<string, ModuleExports> = { 'src/end.ts': esm({ local: ['deep'] }) };
        for (let level = 0; level < 40; level++) {
            const id = `src/level${level}.ts`;
            const next = level === 39 ? 'src/end.ts' : `src/level${level + 1}.ts`;
            deep = deep.module(id, 0).imports(id, next, { specifier: `./${next.slice(4, -3)}` });
            table[id] = esm({ exportAll: [`./${next.slice(4, -3)}`] });
        }
        const graph40 = deep.imports('src/level0.ts', 'src/other.ts', { specifier: './other' }).graph();

        expect(traceBarrel(graph40, 'src/level0.ts', ['deep'], resolver(table))).toBeUndefined();
    });

    it('resolves re-exports by path when the bundler recorded no specifiers', () => {
        const rollup = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module(KIT, 0, UI_KIT)
            .module(BUTTON, 300, UI_KIT)
            .module(DIALOG, 500, UI_KIT)
            .imports('src/main.ts', KIT)
            .imports(KIT, BUTTON)
            .imports(KIT, DIALOG)
            .graph();
        const exportsOf = resolver({
            [KIT]: esm({ reExports: [reExport('Button', './button', 'default'), reExport('Dialog', './dialog.js')] }),
            [BUTTON]: esm({ local: ['default'] }),
            [DIALOG]: esm({ local: ['Dialog'] }),
        });

        expect(traceBarrel(rollup, KIT, ['Button'], exportsOf)).toMatchObject({ definers: [BUTTON], eagerRoots: [BUTTON] });
    });

    it('keeps a dynamic import of the barrel\'s own code lazy, and an edge no statement explains', () => {
        const own = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/index.ts', 0)
            .module('src/a.ts', 100)
            .module('src/b.ts', 200)
            .module('src/lazy.ts', 300)
            .module('src/injected.ts', 50)
            .imports('src/main.ts', 'src/index.ts', { specifier: './index' })
            .imports('src/index.ts', 'src/a.ts', { specifier: './a' })
            .imports('src/index.ts', 'src/b.ts', { specifier: './b' })
            .imports('src/index.ts', 'src/lazy.ts', { specifier: './lazy', kind: 'dynamic' })
            .imports('src/index.ts', 'src/injected.ts', { specifier: 'virtual-helper' })
            .graph();
        const exportsOf = resolver({
            'src/index.ts': esm({ reExports: [reExport('a', './a'), reExport('b', './b')], ownImports: ['./lazy'] }),
            'src/a.ts': esm({ local: ['a'] }),
        });

        expect(traceBarrel(own, 'src/index.ts', ['a'], exportsOf)).toMatchObject({
            eagerRoots: ['src/a.ts', 'src/injected.ts'],
            lazyRoots: ['src/lazy.ts'],
        });
    });
});

describe('scopedImpact', () => {
    const graph = uiKit();

    it('measures the whole module like importImpact', () => {
        expect(scopedImpact(graph, ['src/page.ts'], wholeModule(KIT))).toEqual(importImpact(graph, ['src/page.ts'], KIT));
    });

    it('counts the barrel\'s own bytes and everything the definitions and its own imports pull in', () => {
        const trace = traceBarrel(graph, KIT, ['Dialog'], UI_KIT_EXPORTS)!;
        const impact = scopedImpact(graph, ['src/page.ts'], trace);

        expect(sizes(impact)).toEqual({ bundled: 20 + 40 + 500 + 100 + 200, exclusive: 860, shared: 0, lazy: 0 });
        expect(impact).toMatchObject({ moduleId: KIT, moduleCount: 5, retainedModuleCount: 5, precision: 'bundler-reported' });
        expect(sizes(importImpact(graph, ['src/page.ts'], KIT)).bundled).toBe(1310);
    });

    it('reports what the definitions load on demand as lazy', () => {
        const lazy = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/index.ts', 0)
            .module('src/a.ts', 100)
            .module('src/b.ts', 200)
            .module('src/page.ts', 700)
            .imports('src/main.ts', 'src/index.ts', { specifier: './index' })
            .imports('src/index.ts', 'src/a.ts', { specifier: './a' })
            .imports('src/index.ts', 'src/b.ts', { specifier: './b' })
            .imports('src/a.ts', 'src/page.ts', { specifier: './page', kind: 'dynamic' })
            .graph();
        const trace = traceBarrel(lazy, 'src/index.ts', ['a'], resolver({ 'src/index.ts': esm({ exportAll: ['./a', './b'] }), 'src/a.ts': esm({ local: ['a'] }), 'src/b.ts': esm({ local: ['b'] }) }))!;

        expect(sizes(scopedImpact(lazy, ['src/main.ts'], trace))).toEqual({ bundled: 100, exclusive: 100, shared: 0, lazy: 700 });
    });

    it('counts everything the barrel reaches as shared while another file imports the same barrel, since it may use the same exports', () => {
        const shared = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/page.ts', 10)
            .module('src/settings.ts', 10)
            .module(KIT, 20, UI_KIT)
            .module(BUTTON, 300, UI_KIT)
            .module(DIALOG, 500, UI_KIT)
            .imports('src/main.ts', 'src/page.ts')
            .imports('src/main.ts', 'src/settings.ts')
            .imports('src/page.ts', KIT, { specifier: 'ui-kit' })
            .imports('src/settings.ts', KIT, { specifier: 'ui-kit' })
            .imports(KIT, BUTTON, { specifier: './button.js' })
            .imports(KIT, DIALOG, { specifier: './dialog.js' })
            .graph();
        const trace = traceBarrel(shared, KIT, ['Dialog'], UI_KIT_EXPORTS)!;

        expect(sizes(scopedImpact(shared, ['src/page.ts'], trace))).toEqual({ bundled: 520, exclusive: 0, shared: 520, lazy: 0 });
    });

    it('counts a definition another file imports directly as shared, and the rest as exclusive', () => {
        const direct = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/page.ts', 10)
            .module(KIT, 0, UI_KIT)
            .module(BUTTON, 300, UI_KIT)
            .module(DIALOG, 500, UI_KIT)
            .module(UTIL, 100, UI_KIT)
            .imports('src/main.ts', 'src/page.ts')
            .imports('src/main.ts', BUTTON, { specifier: 'ui-kit/button.js' })
            .imports('src/page.ts', KIT, { specifier: 'ui-kit' })
            .imports(KIT, BUTTON, { specifier: './button.js' })
            .imports(KIT, DIALOG, { specifier: './dialog.js' })
            .imports(BUTTON, UTIL, { specifier: './util.js' })
            .imports(DIALOG, UTIL, { specifier: './util.js' })
            .graph();
        const trace = traceBarrel(direct, KIT, ['Dialog'], UI_KIT_EXPORTS)!;

        expect(sizes(scopedImpact(direct, ['src/page.ts'], trace))).toEqual({ bundled: 600, exclusive: 500, shared: 100, lazy: 0 });
    });

    it('counts what the document\'s other imports of the barrel keep as shared', () => {
        const trace = traceBarrel(graph, KIT, ['Dialog'], UI_KIT_EXPORTS)!;
        const button = traceBarrel(graph, KIT, ['Button'], UI_KIT_EXPORTS)!;

        expect(sizes(scopedImpact(graph, ['src/page.ts'], trace, [button]))).toEqual({ bundled: 860, exclusive: 700, shared: 160, lazy: 0 });
        expect(sizes(scopedImpact(graph, ['src/page.ts'], trace, [wholeModule(KIT)])).exclusive).toBe(0);
    });

    it('reuses the result for the same scope', () => {
        const trace = traceBarrel(graph, KIT, ['Dialog'], UI_KIT_EXPORTS)!;

        expect(scopedImpact(graph, ['src/page.ts'], trace)).toBe(scopedImpact(graph, ['src/page.ts'], { ...trace }));
    });
});

describe('attributeImport through a barrel', () => {
    const graph = uiKit();
    const page = locate(graph, 'src/page.ts');
    const query = (names?: string[], extra: Partial<ImportQuery> = {}): ImportQuery => ({
        specifier: 'ui-kit',
        kind: 'static',
        typeOnly: false,
        ...(names === undefined ? {} : { names }),
        ...extra,
    });
    const barrels: BarrelContext = { exportsOf: UI_KIT_EXPORTS };

    it('charges a named import with the modules that define what it uses', () => {
        const cost = attributeImport(page, query(['Dialog']), barrels);

        expect(cost).toMatchObject({
            status: 'bundled',
            module: { id: KIT },
            package: { name: 'ui-kit' },
            impact: { moduleId: KIT, bundledBytes: 860 },
            barrel: { definers: [DIALOG], names: ['Dialog'] },
        });
    });

    it('keeps the module-level cost without export information, names, or for imports that cannot be narrowed', () => {
        const whole = importImpact(graph, ['src/page.ts'], KIT);

        expect(impactOf(attributeImport(page, query(['Dialog'])))).toBe(whole);
        expect(impactOf(attributeImport(page, query(), barrels))).toBe(whole);
        expect(impactOf(attributeImport(page, query(['Dialog'], { kind: 'require' }), barrels))).toBe(whole);
        expect(attributeImport(page, query(['Missing']), barrels)).not.toHaveProperty('barrel');
    });

    it('counts what the document\'s other imports of the same barrel use as shared', () => {
        const dialog = query(['Dialog']);
        const button = query(['Button']);
        const types = query(['Tabs'], { typeOnly: true });

        const cost = attributeImport(page, dialog, { exportsOf: UI_KIT_EXPORTS, otherImports: [dialog, button, types] });

        expect(sizes(impactOf(cost)!)).toEqual({ bundled: 860, exclusive: 700, shared: 160, lazy: 0 });
    });

    it('counts the whole barrel as kept by another import of it that cannot be narrowed', () => {
        const dialog = query(['Dialog']);
        const namespace = query(undefined, { kind: 'static' });

        expect(impactOf(attributeImport(page, dialog, { exportsOf: UI_KIT_EXPORTS, otherImports: [dialog, namespace] }))?.exclusiveBytes).toBe(0);
    });
});
