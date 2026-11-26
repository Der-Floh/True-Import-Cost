import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

import { analyzeDocument, planRemoval } from '../../parser';

function removalOf(text: string, specifier: string, fileName = 'file.ts'): { readonly replacement: string; readonly edited: string } | undefined {
    const source = analyzeDocument('', fileName, text, { usage: false }).imports.find(candidate => candidate.specifier === specifier);
    expect(source, `the import of ${specifier}`).toBeDefined();
    const removal = planRemoval(text, source!);
    if (!removal) {
        return undefined;
    }
    expect(text.slice(removal.start, removal.end)).toBe(removal.expected);
    return { replacement: removal.replacement, edited: text.slice(0, removal.start) + removal.replacement + text.slice(removal.end) };
}

function compiles(code: string): void {
    expect(() => transformSync(code, { loader: 'ts', format: 'esm' })).not.toThrow();
}

describe('planning to build a file without one of its imports', () => {
    it.each([
        ["import { a, b as c, type T } from 'x';\nexport const use = [a, c];\nlet t: T;", 'x', 'const a = void 0, c = void 0;'],
        ["import d, * as ns from 'x';\nexport const use = [d, ns];", 'x', 'const d = void 0, ns = {};'],
        ["import 'polyfill';\nexport {};", 'polyfill', ';'],
        ["export { a, b as c, default } from 'x';", 'x', 'export const a = void 0, c = void 0; export default void 0;'],
        ["export * as ns from 'x';", 'x', 'export const ns = {};'],
        ["const { a } = require('x');\nexport { a };", 'x', 'const { a } = {};'],
        ["const lib = require('x').default;\nexport { lib };", 'x', '({})'],
        ["require('x');\nexport {};", 'x', ';'],
        ["declare function run(value: unknown): void;\nrun(require('x'));", 'x', '({})'],
        ["export async function load() {\n    const lazy = await import('./lazy');\n    return lazy;\n}", './lazy', 'Promise.resolve({})'],
        ["import fs = require('fs');\nexport const read = fs;", 'fs', 'const fs = {};'],
    ])('replaces the import of %j by %j with %j and still compiles', (text, specifier, replacement) => {
        const removal = removalOf(text, specifier);

        expect(removal?.replacement).toBe(replacement);
        compiles(removal!.edited);
    });

    it.each([
        ["import type { T } from 'x';\nlet t: T;", 'x'],
        ["export * from 'x';", 'x'],
        ["export type { T } from 'x';", 'x'],
    ])('leaves %j alone, since building without it is not measurable', (text, specifier) => {
        expect(removalOf(text, specifier)).toBeUndefined();
    });

    it('works at the import\'s place in a single-file component', () => {
        const component = "<template><p>{{ count }}</p></template>\n<script setup lang=\"ts\">\nimport { ref } from 'vue';\nconst count = ref(1);\n</script>\n";
        const removal = removalOf(component, 'vue', 'App.vue');

        expect(removal?.replacement).toBe('const ref = void 0;');
        expect(removal?.edited).toContain('<script setup lang="ts">\nconst ref = void 0;\nconst count = ref(1);');
    });
});
