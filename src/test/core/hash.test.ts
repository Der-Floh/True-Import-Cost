import { describe, expect, it } from 'vitest';

import { fingerprint } from '../../core/hash';

describe('fingerprint', () => {
    it('returns sixteen lower-case hex digits', () => {
        expect(fingerprint('')).toMatch(/^[0-9a-f]{16}$/);
        expect(fingerprint('{"inputs":{},"outputs":{}}')).toMatch(/^[0-9a-f]{16}$/);
    });

    it('gives the same text the same fingerprint', () => {
        expect(fingerprint('const a = 1;')).toBe(fingerprint('const a = 1;'));
    });

    it('changes when a single character changes or moves', () => {
        expect(fingerprint('{"bytes":120}')).not.toBe(fingerprint('{"bytes":121}'));
        expect(fingerprint('ab')).not.toBe(fingerprint('ba'));
    });

    it('starts with the 32-bit FNV-1a hash of the text, so it stays stable across releases', () => {
        expect(fingerprint('').slice(0, 8)).toBe('811c9dc5');
        expect(fingerprint('a').slice(0, 8)).toBe('e40c292c');
        expect(fingerprint('foobar').slice(0, 8)).toBe('bf9cf968');
    });
});
