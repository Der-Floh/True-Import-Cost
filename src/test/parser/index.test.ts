import { describe, expect, it } from 'vitest';

import { analyzeDocument, isSupportedLanguage, languageOf } from '../../parser';

const UNUSED_IMPORT = "import { unused } from './unused';\n";

describe('languageOf', () => {
    it('maps VS Code language ids', () => {
        expect(['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'vue'].map(id => languageOf(id, 'file'))).toEqual(['ts', 'tsx', 'js', 'jsx', 'vue']);
    });

    it('falls back to the file extension, ignoring case', () => {
        expect(['a.ts', 'a.mts', 'a.cts', 'a.d.ts', 'a.TSX', 'a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'App.vue'].map(name => languageOf('plaintext', name)))
            .toEqual(['ts', 'ts', 'ts', 'ts', 'tsx', 'js', 'js', 'js', 'jsx', 'vue']);
    });

    it('prefers the language id over the extension', () => {
        expect(languageOf('javascript', 'config.ts')).toBe('js');
    });

    it('returns nothing for other languages and files', () => {
        expect(languageOf('svelte', 'App.svelte')).toBeUndefined();
        expect(languageOf('json', 'package.json')).toBeUndefined();
        expect(languageOf('plaintext', 'Makefile')).toBeUndefined();
        expect(isSupportedLanguage('markdown', 'README.md')).toBe(false);
        expect(isSupportedLanguage('plaintext', 'main.ts')).toBe(true);
    });
});

describe('analyzeDocument', () => {
    it('returns nothing for an unsupported document', () => {
        expect(analyzeDocument('markdown', 'README.md', "import a from 'a';", { usage: true })).toEqual({ imports: [], usageAnalysed: false });
    });

    it('works out whether imports are used as values only for TypeScript-family documents', () => {
        const hasValueUsage = (languageId: string, fileName: string) => analyzeDocument(languageId, fileName, UNUSED_IMPORT, { usage: true }).imports[0]?.hasValueUsage;

        expect(hasValueUsage('typescript', 'a.ts')).toBe(false);
        expect(hasValueUsage('typescriptreact', 'a.tsx')).toBe(false);
        expect(hasValueUsage('plaintext', 'a.cts')).toBe(false);
        expect(hasValueUsage('javascript', 'a.js')).toBeUndefined();
        expect(hasValueUsage('javascriptreact', 'a.jsx')).toBeUndefined();
        expect(hasValueUsage('javascript', 'a.ts')).toBeUndefined();
    });

    it('says whether usage was analysed', () => {
        const analysed = analyzeDocument('typescript', 'a.ts', UNUSED_IMPORT, { usage: true });
        const skipped = analyzeDocument('typescript', 'a.ts', UNUSED_IMPORT, { usage: false });

        expect(analysed.usageAnalysed).toBe(true);
        expect(skipped.usageAnalysed).toBe(false);
        expect(skipped.imports[0]?.hasValueUsage).toBeUndefined();
    });

    it('analyses Vue single-file components with their template', () => {
        const text = "<script setup lang=\"ts\">\nimport Hello from './Hello.vue';\n</script>\n<template><Hello /></template>";

        expect(analyzeDocument('vue', 'App.vue', text, { usage: true }).imports).toEqual([expect.objectContaining({
            specifier: './Hello.vue',
            hasValueUsage: true,
            bindings: [expect.objectContaining({ local: 'Hello', templateReferences: 1 })],
        })]);
    });

    it('parses JSX in React documents', () => {
        const text = "import { Button } from './Button';\nexport const view = <Button />;";

        expect(analyzeDocument('javascriptreact', 'view.jsx', text, { usage: true }).imports[0]?.bindings[0]?.calls).toBe(1);
        expect(analyzeDocument('typescriptreact', 'view.tsx', text, { usage: true }).imports[0]?.hasValueUsage).toBe(true);
    });
});
