import { describe, expect, it } from 'vitest';

import { encodeMappings, encodeVlq } from './support/vlq';
import { bytesPerSource } from '../../core/sourcemap';

describe('encodeVlq', () => {
    it('encodes the values used by the tests the way source maps do', () => {
        expect([0, 1, -1, 15, 16, -16, 100].map(encodeVlq)).toEqual(['A', 'C', 'D', 'e', 'gB', 'hB', 'oG']);
    });
});

describe('bytesPerSource', () => {
    it('counts each mapped span towards its source', () => {
        const mappings = encodeMappings([[{ column: 0, source: 0 }, { column: 4, source: 1 }]]);

        expect(bytesPerSource('aaaabbb', { sources: ['a.ts', 'b.ts'], mappings })).toEqual([4, 3]);
    });

    it('stops a span at an unmapped segment', () => {
        const mappings = encodeMappings([[{ column: 0, source: 0 }, { column: 4 }, { column: 8, source: 1 }]]);

        expect(bytesPerSource('aaaa----bbb', { sources: ['a.ts', 'b.ts'], mappings })).toEqual([4, 3]);
    });

    it('restarts columns on each line but carries the source index across lines', () => {
        const mappings = encodeMappings([
            [{ column: 0, source: 1 }, { column: 1, source: 1 }],
            [{ column: 2, source: 1 }],
            [{ column: 0, source: 0 }],
        ]);

        expect(bytesPerSource('bb\n--bbb\naaaa', { sources: ['a.ts', 'b.ts'], mappings })).toEqual([4, 5]);
    });

    it('decodes multi-digit and negative deltas', () => {
        const code = `${'a'.repeat(100)}${'b'.repeat(50)}\n${'c'.repeat(20)}`;
        const mappings = encodeMappings([
            [{ column: 0, source: 0 }, { column: 100, source: 2 }],
            [{ column: 0, source: 1 }],
        ]);

        expect(bytesPerSource(code, { sources: ['a.ts', 'c.ts', 'b.ts'], mappings })).toEqual([100, 20, 50]);
    });

    it('treats segments with a name index like other mapped segments', () => {
        const mappings = encodeMappings([[{ column: 0, source: 0, name: 3 }, { column: 3, source: 1, name: 1 }]]);

        expect(bytesPerSource('abcdef', { sources: ['a.ts', 'b.ts'], mappings })).toEqual([3, 3]);
    });

    it('skips empty lines and ignores code lines without mappings', () => {
        const mappings = encodeMappings([[], [{ column: 0, source: 0 }]]);

        expect(bytesPerSource('/* banner */\nabc\nunmapped tail', { sources: ['a.ts'], mappings })).toEqual([3]);
    });

    it('ignores mapping lines beyond the end of the code', () => {
        const mappings = encodeMappings([[{ column: 0, source: 0 }], [{ column: 0, source: 1 }]]);

        expect(bytesPerSource('abc', { sources: ['a.ts', 'b.ts'], mappings })).toEqual([3, 0]);
    });

    it('clamps spans to the length of the line', () => {
        const mappings = encodeMappings([[{ column: 2, source: 0 }, { column: 40, source: 1 }]]);

        expect(bytesPerSource('abcde', { sources: ['a.ts', 'b.ts'], mappings })).toEqual([3, 0]);
    });

    it('ignores segments that point at a source the map does not list', () => {
        const mappings = encodeMappings([[{ column: 0, source: 0 }, { column: 2, source: 5 }]]);

        expect(bytesPerSource('abcdef', { sources: ['a.ts'], mappings })).toEqual([2]);
    });

    it('keeps a slot for every source, including null ones', () => {
        const mappings = encodeMappings([[{ column: 0, source: 1 }]]);

        expect(bytesPerSource('abc', { sources: [null, 'b.ts', 'c.ts'], mappings })).toEqual([0, 3, 0]);
    });

    it('throws on a character that is not base64', () => {
        expect(() => bytesPerSource('abc', { sources: ['a.ts'], mappings: 'A!AA' })).toThrow(/invalid base64 VLQ character "!"/);
    });
});
