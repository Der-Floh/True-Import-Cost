import { describe, expect, it } from 'vitest';

import { parseJsonc, stripJsonComments } from '../../cli/jsonc';

describe('reading JSON with comments', () => {
    it('reads plain JSON unchanged', () => {
        const text = '{ "a": [1, 2, { "b": null }], "c": "d" }';

        expect(stripJsonComments(text)).toBe(text);
    });

    it('drops line and block comments and trailing commas, as VS Code does in settings.json', () => {
        const text = [
            '{',
            '    // the budgets of every target',
            '    "trueImportCost.budgets": {',
            '        /* the webview */ "webview": { "total": "1 MB", },',
            '        "*": { "packages": { "moment": 0, /* gone */ }, }, // trailing',
            '    },',
            '}',
        ].join('\n');

        expect(parseJsonc(text)).toEqual({ 'trueImportCost.budgets': { webview: { total: '1 MB' }, '*': { packages: { moment: 0 } } } });
    });

    it('keeps comment markers, commas and brackets inside strings', () => {
        expect(parseJsonc('{ "url": "https://example.com/a,]", "glob": "/* not a comment */", "quote": "say \\"hi\\", // still text" }')).toEqual({
            url: 'https://example.com/a,]',
            glob: '/* not a comment */',
            quote: 'say "hi", // still text',
        });
    });

    it('keeps line and column numbers, so a parse error points at the right place', () => {
        const text = '{\n  // comment\n  "a": 1,,\n}';

        expect(stripJsonComments(text).split('\n').map(line => line.length)).toEqual(text.split('\n').map(line => line.length));
    });

    it('removes a trailing comma separated from its bracket by comments and line breaks', () => {
        expect(parseJsonc('[1, 2, // two\r\n /* end */ ]')).toEqual([1, 2]);
    });

    it('rejects what is still invalid once comments are gone', () => {
        expect(() => parseJsonc('{ "a": 1 /* never closed }')).toThrow('a /* comment is never closed');
        expect(() => parseJsonc('{ "a": 1,, }')).toThrow(SyntaxError);
        expect(() => parseJsonc('{ "a": "unterminated\n }')).toThrow(SyntaxError);
    });
});
