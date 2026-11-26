import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync('media/dashboard.html', 'utf8');

function policy(): Map<string, string[]> {
    const content = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(template)?.[1] ?? '';
    return new Map(content.split(';').map(part => part.trim()).filter(Boolean).map((part) => {
        const [name = '', ...sources] = part.split(/\s+/);
        return [name, sources];
    }));
}

describe('the dashboard page template', () => {
    it('denies everything it does not need', () => {
        const directives = policy();

        expect(directives.get('default-src')).toEqual(["'none'"]);
        expect(directives.get('script-src')).toEqual(["'nonce-%NONCE%'"]);
        expect(directives.get('style-src')).toEqual(['%CSP_SOURCE%']);
        expect([...directives.values()].flat().filter(source => source.includes('unsafe'))).toEqual([]);
        expect(directives.has('connect-src')).toBe(false);
    });

    it('loads one script, by nonce, and one stylesheet', () => {
        expect(template.match(/<script/g)).toHaveLength(1);
        expect(template).toContain('<script nonce="%NONCE%" src="%SCRIPT_URI%"></script>');
        expect(template).toContain('<link rel="stylesheet" href="%CSS_URI%" />');
    });

    it('carries no inline script or style', () => {
        expect(template).not.toMatch(/<script(?![^>]*src=)[^>]*>/);
        expect(template).not.toMatch(/<style|style="/);
        expect(template).not.toMatch(/\son[a-z]+=/i);
    });
});
