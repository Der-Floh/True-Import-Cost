import { describe, expect, it } from 'vitest';

import { fixture, inPackage } from './support/snapshot';
import { sizeTotals } from '../../core/chunks';
import { appendHistory, historyEntry, MAX_HISTORY_ENTRIES, parseHistory } from '../../core/history';

import type { HistoryEntry } from '../../core/history';

const TOTALS = { total: 10, javascript: 8, css: 2, assets: 0, initial: 10, lazy: 0 };

function entry(fingerprint: string, createdAt: number): HistoryEntry {
    return { fingerprint, createdAt, totals: TOTALS, packages: [] };
}

describe('a history entry', () => {
    it('records the totals and the largest packages of a build', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('node_modules/a/i.js', 300, inPackage('a'))
            .module('node_modules/b/i.js', 500, inPackage('b'))
            .module('node_modules/c/node_modules/b/i.js', 100, inPackage('b', undefined, 'node_modules/c/node_modules/b'))
            .module('node_modules/gone/i.js', 0, inPackage('gone'))
            .graph();
        const totals = sizeTotals(graph.snapshot);

        expect(historyEntry(graph, 'abc', totals)).toEqual({
            fingerprint: 'abc',
            createdAt: 0,
            totals,
            packages: [{ name: 'b', bytes: 600 }, { name: 'a', bytes: 300 }],
        });
    });
});

describe('appending to the history', () => {
    it('keeps entries in build order', () => {
        const history = appendHistory([entry('a', 1), entry('c', 3)], entry('b', 2));

        expect(history.map(item => item.fingerprint)).toEqual(['a', 'b', 'c']);
    });

    it('records the same build once', () => {
        expect(appendHistory([entry('a', 1)], entry('a', 5))).toEqual([entry('a', 1)]);
    });

    it('drops the oldest entries past the limit', () => {
        const history = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, index) => entry(`e${index}`, index));

        const appended = appendHistory(history, entry('new', 10_000));

        expect(appended).toHaveLength(MAX_HISTORY_ENTRIES);
        expect(appended[0]?.fingerprint).toBe('e1');
        expect(appended.at(-1)?.fingerprint).toBe('new');
    });
});

describe('reading a stored history', () => {
    it('keeps valid entries and drops the rest', () => {
        const stored: unknown = [
            entry('b', 2),
            { fingerprint: 'x', createdAt: 1 },
            { fingerprint: 'y', createdAt: -1, totals: TOTALS },
            entry('a', 1),
            'garbage',
            { ...entry('c', 3), packages: [{ name: 'p', bytes: 1 }, { name: 2 }, null] },
        ];

        const history = parseHistory(stored);

        expect(history.map(item => item.fingerprint)).toEqual(['a', 'b', 'c']);
        expect(history[2]?.packages).toEqual([{ name: 'p', bytes: 1 }]);
    });

    it('reads anything that is not a list as an empty history', () => {
        expect(parseHistory({ entries: [] })).toEqual([]);
        expect(parseHistory(undefined)).toEqual([]);
    });
});
