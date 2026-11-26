import { describe, expect, it } from 'vitest';

import { deltaTone, deltaWord, describeBudget, describeDelta, formatDelta, formatShare, plural } from '../../webview/format';
import { budgetState } from './support/model';

describe('formatDelta', () => {
    it('signs increases and decreases, with a true minus sign', () => {
        expect(formatDelta(2_100)).toBe('+2.1 kB');
        expect(formatDelta(-4_000)).toBe('\u22124 kB');
        expect(formatDelta(-640)).toBe('\u2212640 B');
    });

    it('says "no change" for zero or a missing number', () => {
        expect(formatDelta(0)).toBe('no change');
        expect(formatDelta(Number.NaN)).toBe('no change');
    });
});

describe('deltaTone and deltaWord', () => {
    it('treat growth as bad and shrinking as good', () => {
        expect([deltaTone(1), deltaWord(1)]).toEqual(['bad', 'larger']);
        expect([deltaTone(-1), deltaWord(-1)]).toEqual(['good', 'smaller']);
        expect([deltaTone(0), deltaWord(0)]).toEqual(['neutral', '']);
    });

    it('describe a delta in words as well as a sign', () => {
        expect(describeDelta(15_300)).toBe('+15.3 kB larger');
        expect(describeDelta(-700)).toBe('\u2212700 B smaller');
        expect(describeDelta(0)).toBe('no change');
    });
});

describe('describeBudget', () => {
    it('says by how much a size is over or under its budget', () => {
        expect(describeBudget(budgetState('total', 500_000, 486_300))).toBe('486 kB, 13.7 kB under the budget of 500 kB');
        expect(describeBudget(budgetState('initial', 280_000, 289_900))).toBe('290 kB, 9.9 kB over the budget of 280 kB');
    });
});

describe('formatShare', () => {
    it('rounds to whole percent and says when a share is below one percent', () => {
        expect(formatShare(1, 3)).toBe('33%');
        expect(formatShare(1, 1_000)).toBe('<1%');
        expect(formatShare(5, 5)).toBe('100%');
    });

    it('is 0% for nothing, or out of nothing', () => {
        expect(formatShare(0, 10)).toBe('0%');
        expect(formatShare(10, 0)).toBe('0%');
    });
});

describe('plural', () => {
    it('counts in the singular only for one', () => {
        expect(plural(1, 'module')).toBe('1 module');
        expect(plural(2, 'module')).toBe('2 modules');
        expect(plural(0, 'copy', 'copies')).toBe('0 copies');
    });
});
