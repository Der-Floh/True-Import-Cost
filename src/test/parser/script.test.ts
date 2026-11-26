import { describe, expect, it } from 'vitest';

import { analyzeScript } from '../../parser/script';

import type { ScriptOptions } from '../../parser/script';
import type { BindingUsage, ScriptLanguage, SourceImport } from '../../parser/types';

function analyze(text: string, language: ScriptLanguage = 'ts', options: Partial<ScriptOptions> = {}): SourceImport[] {
    return analyzeScript(text, language, { usage: true, elidesUnusedImports: language === 'ts' || language === 'tsx', ...options });
}

function single(text: string, language?: ScriptLanguage, options?: Partial<ScriptOptions>): SourceImport {
    const imports = analyze(text, language, options);
    if (imports.length !== 1) {
        throw new Error(`expected one import, found ${imports.length}`);
    }
    return imports[0]!;
}

function usage(text: string, local: string, language?: ScriptLanguage): BindingUsage {
    const found = analyze(text, language).flatMap(each => each.bindings).find(binding => binding.local === local);
    if (!found) {
        throw new Error(`no binding named ${local}`);
    }
    return found;
}

function shape(source: SourceImport): Pick<SourceImport, 'specifier' | 'kind' | 'typeOnly'> & { bindings: string[] } {
    return {
        specifier: source.specifier,
        kind: source.kind,
        typeOnly: source.typeOnly,
        bindings: source.bindings.map(binding => `${binding.imported === binding.local ? binding.local : `${binding.imported} as ${binding.local}`}${binding.typeOnly ? ' (type)' : ''}`),
    };
}

function textAt(text: string, range: { start: number; end: number }): string {
    return text.slice(range.start, range.end);
}

describe('analyzeScript static imports', () => {
    it('reads a default import', () => {
        expect(shape(single("import React from 'react';"))).toEqual({ specifier: 'react', kind: 'default', typeOnly: false, bindings: ['default as React'] });
    });

    it('reads named imports with the names they import', () => {
        expect(shape(single("import { map, filter as keep, 'kebab-name' as kebab } from 'lodash-es';"))).toEqual({
            specifier: 'lodash-es',
            kind: 'named',
            typeOnly: false,
            bindings: ['map', 'filter as keep', 'kebab-name as kebab'],
        });
    });

    it('reads a namespace import', () => {
        expect(shape(single("import * as vscode from 'vscode';"))).toEqual({ specifier: 'vscode', kind: 'namespace', typeOnly: false, bindings: ['* as vscode'] });
    });

    it('reads a default import combined with named or namespace bindings', () => {
        expect(shape(single("import React, { useState } from 'react';"))).toMatchObject({ kind: 'named', bindings: ['default as React', 'useState'] });
        expect(shape(single("import def, * as all from './mod';"))).toMatchObject({ kind: 'namespace', bindings: ['default as def', '* as all'] });
    });

    it('reads a side-effect import', () => {
        expect(shape(single("import './polyfill';"))).toEqual({ specifier: './polyfill', kind: 'side-effect', typeOnly: false, bindings: [] });
    });

    it('reads an empty named import as an import without bindings', () => {
        expect(shape(single("import {} from './setup';"))).toEqual({ specifier: './setup', kind: 'named', typeOnly: false, bindings: [] });
    });

    it('reads imports that carry import attributes', () => {
        expect(shape(single("import data from './data.json' with { type: 'json' };"))).toMatchObject({ specifier: './data.json', kind: 'default' });
    });

    it('marks import type declarations as type-only', () => {
        expect(shape(single("import type { Uri } from 'vscode';"))).toMatchObject({ typeOnly: true, bindings: ['Uri (type)'] });
        expect(shape(single("import type Config from './config';"))).toMatchObject({ typeOnly: true, kind: 'default', bindings: ['default as Config (type)'] });
        expect(shape(single("import type * as Types from './types';"))).toMatchObject({ typeOnly: true, kind: 'namespace' });
    });

    it('marks an import whose specifiers are all inline type imports as type-only', () => {
        expect(shape(single("import { type Uri, type Range as R } from 'vscode';"))).toMatchObject({ typeOnly: true, bindings: ['Uri (type)', 'Range as R (type)'] });
    });

    it('keeps an import with any value specifier as a value import', () => {
        expect(shape(single("import { type Uri, window } from 'vscode';"))).toMatchObject({ typeOnly: false, bindings: ['Uri (type)', 'window'] });
        expect(shape(single("import vscode, { type Uri } from 'vscode';"))).toMatchObject({ typeOnly: false });
    });
});

describe('analyzeScript re-exports', () => {
    it.each<[string, Pick<SourceImport, 'kind' | 'typeOnly'>]>([
        ["export { map, filter as keep } from 'lodash-es';", { kind: 're-export', typeOnly: false }],
        ["export * from './util';", { kind: 'export-all', typeOnly: false }],
        ["export * as util from './util';", { kind: 're-export', typeOnly: false }],
        ["export {} from './util';", { kind: 're-export', typeOnly: false }],
        ["export type { Config } from './config';", { kind: 're-export', typeOnly: true }],
        ["export { type Config, type Options } from './config';", { kind: 're-export', typeOnly: true }],
        ["export { type Config, defaults } from './config';", { kind: 're-export', typeOnly: false }],
        ["export type * from './types';", { kind: 'export-all', typeOnly: true }],
        ["export type * as Types from './types';", { kind: 're-export', typeOnly: true }],
    ])('reads %s', (text, expected) => {
        expect(single(text)).toMatchObject({ ...expected, bindings: [] });
    });

    it('ignores exports that do not name a module', () => {
        expect(analyze('const a = 1;\nexport { a };\nexport default a;')).toEqual([]);
    });
});

describe('analyzeScript import-equals declarations', () => {
    it('reads an import-equals declaration of a module', () => {
        expect(shape(single("import fs = require('fs');"))).toEqual({ specifier: 'fs', kind: 'import-equals', typeOnly: false, bindings: ['* as fs'] });
        expect(shape(single("import type fs = require('fs');"))).toMatchObject({ typeOnly: true, bindings: ['* as fs (type)'] });
    });

    it('ignores an import-equals alias of a namespace', () => {
        expect(analyze('namespace Shapes { export const sides = 4; }\nimport Square = Shapes.sides;')).toEqual([]);
    });
});

describe('analyzeScript dynamic imports', () => {
    it('reads a dynamic import assigned to a variable', () => {
        const text = "const page = await import('./pages/About');";
        const source = single(text);

        expect(shape(source)).toEqual({ specifier: './pages/About', kind: 'dynamic', typeOnly: false, bindings: ['* as page'] });
        expect(textAt(text, source.range)).toBe("import('./pages/About')");
    });

    it('reads the bindings destructured from a dynamic import', () => {
        expect(shape(single("const { render, version: v, ...rest } = await import('./lib');"))).toMatchObject({ bindings: ['render', 'version as v', '* as rest'] });
    });

    it('reads dynamic imports used directly and with a template literal', () => {
        expect(analyze("import('./a').then(m => m.run());\nconst b = import(`./b`);").map(shape)).toEqual([
            { specifier: './a', kind: 'dynamic', typeOnly: false, bindings: [] },
            { specifier: './b', kind: 'dynamic', typeOnly: false, bindings: ['* as b'] },
        ]);
    });

    it('ignores dynamic imports of computed specifiers', () => {
        expect(analyze('const name = "a";\nimport(name);\nimport(`./${name}`);\nimport("./" + name);')).toEqual([]);
    });

    it('finds dynamic imports nested in functions', () => {
        expect(analyze("export function load() {\n    return () => import('./deep');\n}").map(each => each.specifier)).toEqual(['./deep']);
    });

    it('reads the default export destructured from a dynamic import', () => {
        expect(shape(single("const { default: Chart } = await import('./Chart.vue');"))).toMatchObject({ bindings: ['default as Chart'] });
    });

    it('ignores import types and import.meta calls', () => {
        expect(analyze("type Lazy = typeof import('./lazy');\nlet x: import('./other').Foo;\nconst modules = import.meta.glob('./pages/*.ts');")).toEqual([]);
    });
});

describe('analyzeScript require calls', () => {
    it('reads a require assigned to a variable, covering the whole statement', () => {
        const text = "const fs = require('fs');";
        const source = single(text, 'js');

        expect(shape(source)).toEqual({ specifier: 'fs', kind: 'require', typeOnly: false, bindings: ['* as fs'] });
        expect(textAt(text, source.range)).toBe(text);
    });

    it('reads the bindings destructured from a require', () => {
        expect(shape(single("const { readFile, writeFile: write } = require('fs');", 'js'))).toMatchObject({ bindings: ['readFile', 'writeFile as write'] });
    });

    it('reads a bare require statement as a side-effect import', () => {
        expect(shape(single("require('./polyfill');", 'js'))).toEqual({ specifier: './polyfill', kind: 'side-effect', typeOnly: false, bindings: [] });
    });

    it('reads a require used inside an expression', () => {
        const text = "module.exports = wrap(require('./impl'));";
        const source = single(text, 'js');

        expect(shape(source)).toEqual({ specifier: './impl', kind: 'require', typeOnly: false, bindings: [] });
        expect(textAt(text, source.range)).toBe("require('./impl')");
    });

    it('ignores require calls that are not plain module requires', () => {
        expect(analyze("const name = 'x';\nrequire(name);\nrequire('a', 'b');\nrequire.resolve('c');", 'js')).toEqual([]);
    });

    it('does not treat a call to a locally declared require as an import', () => {
        expect(analyze("function load(require) {\n    return require('./plugin');\n}", 'js')).toEqual([]);
        expect(analyze("import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nconst pkg = require('./package.json');").map(each => each.specifier))
            .toEqual(['node:module']);
    });

    it('does not treat a call to a locally declared require as an import when usage analysis is off', () => {
        expect(analyze("function load(require) {\n    return require('./plugin');\n}", 'js', { usage: false })).toEqual([]);
    });
});

describe('analyzeScript ordering and ranges', () => {
    it('returns imports in source order', () => {
        const text = "const lazy = () => import('./lazy');\nimport main from './main';\nexport * from './all';\nconst fs = require('fs');";

        expect(analyze(text).map(each => each.specifier)).toEqual(['./lazy', './main', './all', 'fs']);
    });

    it('gives the range of the statement and of the quoted specifier', () => {
        const text = "// header\nimport { a } from './a';\n";
        const source = single(text);

        expect(textAt(text, source.range)).toBe("import { a } from './a';");
        expect(textAt(text, source.specifierRange)).toBe("'./a'");
    });

    it('shifts ranges by the given offset', () => {
        const source = single("import a from './a';", 'ts', { offset: 100 });

        expect(source.range).toEqual({ start: 100, end: 120 });
        expect(source.specifierRange).toEqual({ start: 114, end: 119 });
    });

    it('still reads imports from a file with syntax errors', () => {
        expect(analyze("import { a } from './a';\nconst = ;\nimport b from './b';").map(each => each.specifier)).toEqual(['./a', './b']);
    });

    it('returns nothing for an empty document', () => {
        expect(analyze('')).toEqual([]);
    });
});

describe('analyzeScript usage of named and default imports', () => {
    it('counts calls of an imported function', () => {
        expect(usage("import { debounce } from 'lodash-es';\ndebounce(save, 100);\nexport const fast = () => debounce(load);", 'debounce'))
            .toMatchObject({ valueReferences: 2, calls: 2, typeReferences: 0, escapes: false, dynamicAccess: false, members: [] });
    });

    it('counts constructor calls and tagged templates as calls', () => {
        expect(usage("import { Emitter } from './events';\nnew Emitter();", 'Emitter')).toMatchObject({ calls: 1, escapes: false });
        expect(usage("import { html } from 'lit';\nconst view = html`<p>hi</p>`;", 'html')).toMatchObject({ calls: 1, escapes: false });
    });

    it('records the members used on a default-imported object', () => {
        expect(usage("import api from './api';\napi.get('/users');\nconst base = api.baseUrl;", 'api').members).toEqual([
            { name: 'get', kind: 'call' },
            { name: 'baseUrl', kind: 'access' },
        ]);
    });

    it('does not let typeof, void, delete or instanceof make a value escape', () => {
        const binding = usage("import { Widget } from './widget';\ntypeof Widget;\nvoid Widget;\nif (x instanceof Widget) {}\ndelete Widget.cache;", 'Widget');

        expect(binding).toMatchObject({ valueReferences: 4, escapes: false, calls: 0 });
    });
});

describe('analyzeScript usage of namespace imports', () => {
    const text = [
        "import * as _ from 'lodash';",
        '_.map(items, toLabel);',
        'const version = _.VERSION;',
        'const wrapped = new _.Wrapper(items);',
        "_['chunk'](items, 2);",
        '_[0];',
        '_?.debounce?.(save);',
        '_.tag`text`;',
    ].join('\n');

    it('records each member with how it is used', () => {
        expect(usage(text, '_')).toMatchObject({
            valueReferences: 7,
            calls: 0,
            escapes: false,
            dynamicAccess: false,
            members: [
                { name: 'map', kind: 'call' },
                { name: 'VERSION', kind: 'access' },
                { name: 'Wrapper', kind: 'construct' },
                { name: 'chunk', kind: 'call' },
                { name: '0', kind: 'access' },
                { name: 'debounce', kind: 'call' },
                { name: 'tag', kind: 'call' },
            ],
        });
    });

    it('keeps the strongest use of a member', () => {
        const members = usage("import * as ns from './ns';\nns.a;\nns.a();\nconst { b } = ns;\nns.b;\nns.c;\nnew ns.c();\nns.c;", 'ns').members;

        expect(members).toEqual([{ name: 'a', kind: 'call' }, { name: 'b', kind: 'access' }, { name: 'c', kind: 'construct' }]);
    });

    it('records destructured members without letting the namespace escape', () => {
        expect(usage("import * as path from 'node:path';\nconst { join, resolve: toAbsolute = fallback } = path;", 'path'))
            .toMatchObject({ escapes: false, members: [{ name: 'join', kind: 'destructure' }, { name: 'resolve', kind: 'destructure' }] });
    });

    it('lets the namespace escape when a rest element collects the other members', () => {
        expect(usage("import * as path from 'node:path';\nconst { join, ...others } = path;", 'path'))
            .toMatchObject({ escapes: true, members: [{ name: 'join', kind: 'destructure' }] });
    });

    it('marks computed member access as dynamic and escaping', () => {
        expect(usage("import * as icons from './icons';\nexport const icon = (name: string) => icons[name];", 'icons'))
            .toMatchObject({ dynamicAccess: true, escapes: true, members: [] });
    });

    it('lets the namespace escape when a destructuring key is computed', () => {
        expect(usage("import * as icons from './icons';\nconst key = 'add';\nconst { [key]: icon } = icons;", 'icons')).toMatchObject({ escapes: true });
    });
});

describe('analyzeScript escaping values', () => {
    it.each([
        ['passed as an argument', 'register(ns);'],
        ['spread into an object', 'const all = { ...ns };'],
        ['spread into a call', 'Math.max(...ns);'],
        ['exported by name', 'export { ns };'],
        ['exported as default', 'export default ns;'],
        ['put into a shorthand property', 'const api = { ns };'],
        ['assigned to another variable', 'const alias = ns;'],
        ['returned from a function', 'function get() { return ns; }'],
        ['extended by a class', 'class Panel extends ns {}'],
    ])('marks a namespace %s as escaping', (_, statement) => {
        expect(usage(`import * as ns from './ns';\n${statement}`, 'ns')).toMatchObject({ valueReferences: 1, escapes: true });
    });
});

describe('analyzeScript type positions', () => {
    it.each([
        ['a type annotation', 'let a: Foo;'],
        ['a generic argument', 'const list: Array<Foo> = [];'],
        ['a call type argument', 'create<Foo>();'],
        ['typeof in a type', 'let b: typeof Foo;'],
        ['a qualified type name', 'let c: Foo.Options;'],
        ['typeof of a member in a type', 'let d: typeof Foo.defaults;'],
        ['an implements clause', 'class A implements Foo {}'],
        ['an interface extends clause', 'interface B extends Foo {}'],
        ['an as expression', 'const e = value as Foo;'],
        ['a satisfies expression', 'const f = value satisfies Foo;'],
    ])('counts a reference in %s as a type reference', (_, statement) => {
        expect(usage(`import { Foo } from './foo';\n${statement}`, 'Foo')).toMatchObject({ typeReferences: 1, valueReferences: 0, escapes: false });
    });

    it('counts a class extends clause as a value reference', () => {
        expect(usage("import { Base } from './base';\nclass Panel extends Base {}", 'Base')).toMatchObject({ typeReferences: 0, valueReferences: 1 });
    });

    it('counts a member in a class extends clause as a member of the namespace', () => {
        expect(usage("import * as ui from './ui';\nclass Panel extends ui.Base {}", 'ui')).toMatchObject({ valueReferences: 1, escapes: false, members: [{ name: 'Base', kind: 'access' }] });
    });

    it('counts a member in an implements clause as a type reference', () => {
        expect(usage("import * as ui from './ui';\nclass Panel implements ui.Widget {}", 'ui')).toMatchObject({ typeReferences: 1, valueReferences: 0 });
    });
});

describe('analyzeScript JSX', () => {
    it('counts an element as a call of the component', () => {
        expect(usage("import { Button } from './Button';\nexport const view = <Button label='ok' />;", 'Button', 'tsx'))
            .toMatchObject({ valueReferences: 1, calls: 1, escapes: false });
    });

    it('counts an element with children once', () => {
        expect(usage("import Layout from './Layout';\nexport const page = <Layout><p>hi</p></Layout>;", 'Layout', 'jsx')).toMatchObject({ calls: 1, escapes: false });
    });

    it('records a member used as a tag name', () => {
        expect(usage("import * as UI from './ui';\nexport const view = <UI.Dialog open />;", 'UI', 'tsx'))
            .toMatchObject({ escapes: false, members: [{ name: 'Dialog', kind: 'access' }] });
    });

    it('lets a value passed as a prop escape', () => {
        expect(usage("import { onSave } from './actions';\nexport const view = <form onSubmit={onSave} />;", 'onSave', 'tsx')).toMatchObject({ escapes: true });
    });
});

describe('analyzeScript symbol resolution', () => {
    it.each([
        ['a function parameter', 'function f(value) { return value; }'],
        ['an arrow function parameter', 'const f = (value) => value * 2;'],
        ['a block-scoped constant', '{ const value = 1; console.log(value); }'],
        ['a catch clause variable', 'try { run(); } catch (value) { report(value); }'],
        ['a for-of variable', 'for (const value of list) { use(value); }'],
        ['a method parameter', 'class A { m(value) { return value; } }'],
    ])('ignores references to %s that shadows the import', (_, statement) => {
        expect(usage(`import { value } from './value';\n${statement}`, 'value')).toMatchObject({ valueReferences: 0, typeReferences: 0, escapes: false });
    });

    it('ignores a generic type parameter that shadows an imported type', () => {
        expect(usage("import type { Item } from './item';\nfunction first<Item>(list: Item[]): Item { return list[0]; }", 'Item')).toMatchObject({ typeReferences: 0 });
    });

    it('ignores property names that merely look like the import', () => {
        expect(usage("import { value } from './value';\nconst o = { value: 1 };\no.value;\nclass A { value = 2; }", 'value')).toMatchObject({ valueReferences: 0 });
    });

    it('counts references in nested scopes that do not shadow the import', () => {
        expect(usage("import { value } from './value';\nfunction outer() {\n    return () => value + 1;\n}", 'value')).toMatchObject({ valueReferences: 1, escapes: true });
    });

    it('tracks bindings of a dynamic import and of a require', () => {
        expect(usage("const page = await import('./page');\npage.render();", 'page')).toMatchObject({ members: [{ name: 'render', kind: 'call' }] });
        expect(usage("const fs = require('fs');\nfs.readFileSync('a');", 'fs', 'js')).toMatchObject({ members: [{ name: 'readFileSync', kind: 'call' }] });
    });
});

describe('analyzeScript hasValueUsage', () => {
    it('is true for a TypeScript import that is used as a value', () => {
        expect(single("import { render } from './render';\nrender();").hasValueUsage).toBe(true);
    });

    it('is false for a TypeScript import used only as a type or not at all', () => {
        expect(single("import { Options } from './options';\nlet o: Options;").hasValueUsage).toBe(false);
        expect(single("import { unused } from './unused';").hasValueUsage).toBe(false);
        expect(single("import {} from './setup';").hasValueUsage).toBe(false);
    });

    it('ignores inline type specifiers when deciding', () => {
        expect(single("import { type Options, defaults } from './options';\nlet o: Options;").hasValueUsage).toBe(false);
    });

    it('counts template references as value usage', () => {
        expect(single("import Hello from './Hello.vue';", 'ts', { templateIdentifiers: new Set(['Hello']) })).toMatchObject({
            hasValueUsage: true,
            bindings: [expect.objectContaining({ templateReferences: 1, valueReferences: 0 })],
        });
    });

    it('is computed for import-equals declarations', () => {
        expect(single("import fs = require('fs');\nfs.readFileSync('a');").hasValueUsage).toBe(true);
    });

    it('is left out for side-effect, dynamic, require and re-export imports', () => {
        const imports = analyze("import './a';\nconst b = await import('./b');\nconst c = require('./c');\nexport { d } from './d';\nexport * from './e';");

        expect(imports.map(each => each.hasValueUsage)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    });

    it('is left out when the language keeps unused imports', () => {
        expect(single("import { unused } from './unused';", 'js').hasValueUsage).toBeUndefined();
        expect(single("import { unused } from './unused';", 'ts', { elidesUnusedImports: false }).hasValueUsage).toBeUndefined();
    });

    it('is left out, with empty usage, when usage analysis is off', () => {
        const source = single("import * as ns from './ns';\nns.run(ns);", 'ts', { usage: false });

        expect(source.hasValueUsage).toBeUndefined();
        expect(source.bindings).toEqual([{
            local: 'ns',
            imported: '*',
            typeOnly: false,
            valueReferences: 0,
            typeReferences: 0,
            templateReferences: 0,
            calls: 0,
            members: [],
            escapes: false,
            dynamicAccess: false,
        }]);
    });
});
