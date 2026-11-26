import { describe, expect, it } from 'vitest';

import { analyzeExports } from '../../parser';

import type { ExportAnalysis, ModuleExports } from '../../parser';

function exportsOf(text: string, fileName = 'index.ts', languageId = ''): ExportAnalysis {
    return analyzeExports(languageId, fileName, text);
}

function esm(text: string, fileName?: string): ModuleExports {
    const analysis = exportsOf(text, fileName);
    if (analysis.kind !== 'esm') {
        throw new Error('expected an ES module');
    }
    return analysis;
}

describe('analyzeExports on names a module defines', () => {
    it('lists exported declarations, including destructured variables', () => {
        const analysis = esm([
            'const object = { b: 1, c: [2] };',
            'export const a = 1, { b, c: [d] } = object;',
            'export let e;',
            'export function f() {}',
            'export class C {}',
            'export enum E { One }',
            'export namespace N { export const inner = 1; }',
        ].join('\n'));

        expect(analysis.local).toEqual(['a', 'b', 'd', 'e', 'f', 'C', 'E', 'N']);
        expect(analysis.reExports).toEqual([]);
    });

    it.each([
        ['export default function () {}'],
        ['export default class Widget {}'],
        ['export default 42;'],
        ['const value = 1;\nexport { value as default };'],
    ])('counts %s as a default it defines', (text) => {
        expect(esm(text).local).toEqual(['default']);
    });

    it('counts a local exported under another name by that name', () => {
        expect(esm('const internal = 1;\nexport { internal as external };').local).toEqual(['external']);
    });

    it('leaves out types, ambient declarations and type-only re-exports', () => {
        const analysis = esm([
            'export interface Options {}',
            'export type Size = number;',
            'export declare const injected: string;',
            "export type { Shape } from './shapes';",
            "export type * from './types';",
            "export { type Color, paint } from './colors';",
            'export const real = 1;',
        ].join('\n'));

        expect(analysis.local).toEqual(['real']);
        expect(analysis.reExports).toEqual([{ name: 'paint', imported: 'paint', specifier: './colors' }]);
        expect(analysis.exportAll).toEqual([]);
    });
});

describe('analyzeExports on names a module re-exports', () => {
    it('records named re-exports with the name in the module they come from', () => {
        expect(esm("export { a, b as c, default as d } from './x';\nexport { e as default } from './y';").reExports).toEqual([
            { name: 'a', imported: 'a', specifier: './x' },
            { name: 'c', imported: 'b', specifier: './x' },
            { name: 'd', imported: 'default', specifier: './x' },
            { name: 'default', imported: 'e', specifier: './y' },
        ]);
    });

    it('records a namespace re-export as the whole module', () => {
        expect(esm("export * as icons from './icons';").reExports).toEqual([{ name: 'icons', imported: '*', specifier: './icons' }]);
    });

    it('lists the modules every export of which it passes on, once each', () => {
        const analysis = esm("export * from './a';\nexport * from './b';\nexport * from './a';");

        expect(analysis.exportAll).toEqual(['./a', './b']);
        expect(analysis.reExports).toEqual([]);
    });

    it('treats an import that is only exported again as a re-export', () => {
        const analysis = esm([
            "import Button from './Button';",
            "import { Dialog as Modal } from './Dialog';",
            "import * as icons from './icons';",
            "import theme from './theme';",
            'export { Button, Modal as Dialog, icons };',
            'export default theme;',
        ].join('\n'));

        expect(analysis.reExports).toEqual([
            { name: 'Button', imported: 'default', specifier: './Button' },
            { name: 'Dialog', imported: 'Dialog', specifier: './Dialog' },
            { name: 'icons', imported: '*', specifier: './icons' },
            { name: 'default', imported: 'default', specifier: './theme' },
        ]);
        expect(analysis.local).toEqual([]);
        expect(analysis.ownImports).toEqual([]);
    });

    it('reads export names written as strings', () => {
        expect(esm("export { a as 'kebab-name' } from './x';").reExports).toEqual([{ name: 'kebab-name', imported: 'a', specifier: './x' }]);
    });

    it('reads a lodash-es style barrel', () => {
        const analysis = esm([
            '/** @license MIT */',
            "export { default as add } from './add.js';",
            "export { default as debounce } from './debounce.js';",
            "export { default } from './lodash.default.js';",
        ].join('\n'), 'node_modules/lodash-es/lodash.js');

        expect(analysis.reExports.map(each => [each.name, each.specifier])).toEqual([
            ['add', './add.js'],
            ['debounce', './debounce.js'],
            ['default', './lodash.default.js'],
        ]);
        expect(analysis.ownImports).toEqual([]);
    });
});

describe('analyzeExports on what the module needs for its own code', () => {
    it('lists side-effect imports, imports its own code uses, dead imports, dynamic imports and require calls', () => {
        const analysis = esm([
            "import './styles.css';",
            "import { helper } from './helper';",
            "import { unused } from './dead';",
            "import { shared } from './shared';",
            'export { shared };',
            'export const value = helper(shared);',
            "export const later = () => import('./lazy');",
            "export const legacy = () => require('./legacy');",
        ].join('\n'), 'index.js');

        expect(analysis.ownImports).toEqual(['./styles.css', './helper', './dead', './shared', './lazy', './legacy']);
        expect(analysis.reExports).toEqual([{ name: 'shared', imported: 'shared', specifier: './shared' }]);
        expect(analysis.local).toEqual(['value', 'later', 'legacy']);
    });

    it('does not count property names, labels or type positions as uses of an import', () => {
        const analysis = esm([
            "import { item } from './item';",
            "import { Kind } from './kind';",
            'export { item, Kind };',
            'const options = { item: 1, Kind: 2 };',
            'class Holder { item = 1; Kind(): void {} }',
            'export function read(input: Kind): number { item: for (;;) { break item; } return options.item + new Holder().item; }',
        ].join('\n'));

        expect(analysis.ownImports).toEqual([]);
        expect(analysis.reExports.map(each => each.name)).toEqual(['item', 'Kind']);
    });

    it('counts an import used in JSX or in a shorthand property as used by its own code', () => {
        const analysis = esm([
            "import { Button } from './Button';",
            "import { theme } from './theme';",
            'export { Button, theme };',
            'export const App = () => <Button />;',
            'export const config = { theme };',
        ].join('\n'), 'index.jsx');

        expect(analysis.ownImports).toEqual(['./Button', './theme']);
    });

    it('ignores imports erased during compilation', () => {
        expect(esm("import type { A } from './a';\nimport { type B } from './b';\nexport const c = 1;").ownImports).toEqual([]);
    });
});

describe('analyzeExports on modules it cannot read reliably', () => {
    it.each([
        ['module.exports', 'module.exports = { a: 1 };'],
        ['exports properties', 'exports.a = 1;'],
        ['a require-only module', "const a = require('./a');\nfunction run() { return a; }"],
        ['a plain script', 'function run() {}\nrun();'],
        ['an ES module that also assigns module.exports', 'export const a = 1;\nmodule.exports = { a };'],
        ['an ES module that also writes to exports', "export const a = 1;\nObject.defineProperty(exports, 'b', { value: 2 });"],
        ['a syntax error', 'export const = ;'],
    ])('reports %s as unknown', (_, text) => {
        expect(exportsOf(text, 'index.js')).toEqual({ kind: 'unknown' });
    });

    it('reports export = as unknown', () => {
        expect(exportsOf('const value = 1;\nexport = value;', 'index.ts')).toEqual({ kind: 'unknown' });
    });

    it('reports TypeScript syntax in a JavaScript file as unknown', () => {
        expect(exportsOf('export const a: number = 1;', 'index.js')).toEqual({ kind: 'unknown' });
    });

    it('reports Vue components and files of other languages as unknown', () => {
        expect(exportsOf("<script>export { a } from './a';</script>", 'Barrel.vue')).toEqual({ kind: 'unknown' });
        expect(exportsOf('{ "a": 1 }', 'data.json')).toEqual({ kind: 'unknown' });
    });

    it.each(['index.cjs', 'index.cts'])('reports %s as unknown, since the file is CommonJS whatever its syntax', (fileName) => {
        expect(exportsOf("export { a } from './a';", fileName)).toEqual({ kind: 'unknown' });
    });
});

describe('analyzeExports on files of every script language', () => {
    it.each(['index.js', 'index.mjs', 'index.jsx', 'index.ts', 'index.mts', 'index.tsx'])('reads %s', (fileName) => {
        expect(exportsOf("export { a } from './a';", fileName)).toMatchObject({ kind: 'esm', reExports: [{ name: 'a' }] });
    });

    it('prefers the language id over the extension', () => {
        expect(exportsOf('export const a: number = 1;', 'index.js', 'typescript')).toMatchObject({ kind: 'esm', local: ['a'] });
    });
});
