import { describe, expect, it } from 'vitest';

import { linearScale, niceStep, timeTicks, valueTicks } from '../../webview/chart/scales';
import { DAY, HOUR, MINUTE } from './support/model';

describe('niceStep', () => {
    it('picks 1, 2 or 5 times a power of ten', () => {
        expect(niceStep(412_000, 4)).toBe(100_000);
        expect(niceStep(900, 4)).toBe(200);
        expect(niceStep(217_900, 4)).toBe(50_000);
        expect(niceStep(80, 4)).toBe(20);
    });
});

describe('valueTicks', () => {
    it('starts at zero when the values reach down towards it', () => {
        expect(valueTicks(20_000, 412_000, 4)).toEqual([0, 100_000, 200_000, 300_000, 400_000, 500_000]);
    });

    it('zooms in on values far from zero so changes stay visible', () => {
        expect(valueTicks(268_400, 486_300, 4)).toEqual([250_000, 300_000, 350_000, 400_000, 450_000, 500_000]);
    });

    it('always covers the largest value', () => {
        const ticks = valueTicks(0, 1_234_567, 4);

        expect(ticks.at(-1)).toBeGreaterThanOrEqual(1_234_567);
        expect(ticks[0]).toBe(0);
    });

    it('has a default scale when there is nothing to show', () => {
        expect(valueTicks(0, 0, 4)).toEqual([0, 1000]);
        expect(valueTicks(Number.NaN, Number.NaN, 4)).toEqual([0, 1000]);
    });
});

describe('linearScale', () => {
    it('maps the domain onto the range', () => {
        const scale = linearScale([0, 100], [200, 0]);

        expect([scale(0), scale(25), scale(100)]).toEqual([200, 150, 0]);
    });

    it('puts everything in the middle when the domain is a single value', () => {
        expect(linearScale([5, 5], [0, 100])(5)).toBe(50);
    });
});

describe('timeTicks', () => {
    const DAY_LABEL = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const TIME_LABEL = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

    function midnight(offsetDays: number): number {
        const date = new Date(2026, 10, 18);
        date.setDate(date.getDate() + offsetDays);
        return date.getTime();
    }

    it('marks local midnights across several days', () => {
        const ticks = timeTicks(midnight(0) + 10 * HOUR, midnight(8) + 3 * HOUR, 10);

        expect(ticks.map(tick => tick.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(midnight));
        expect(ticks[0]!.label).toBe(DAY_LABEL.format(midnight(1)));
    });

    it('spaces the day ticks out when there is little room', () => {
        const ticks = timeTicks(midnight(0) + 10 * HOUR, midnight(8) + 3 * HOUR, 3);

        expect(ticks.map(tick => tick.value)).toEqual([midnight(1), midnight(8)]);
    });

    it('marks hours within a day, labelled with the time', () => {
        const start = midnight(0) + 9 * HOUR + 20 * MINUTE;
        const ticks = timeTicks(start, start + 5 * HOUR, 6);

        expect(ticks.map(tick => tick.value)).toEqual([10, 11, 12, 13, 14].map(hour => midnight(0) + hour * HOUR));
        expect(ticks[0]!.label).toBe(TIME_LABEL.format(midnight(0) + 10 * HOUR));
    });

    it('falls back to a single tick at the start', () => {
        const start = midnight(0) + 9 * HOUR + 20 * MINUTE + 5_000;

        expect(timeTicks(start, start, 5)).toEqual([{ value: start, label: TIME_LABEL.format(start) }]);
        expect(timeTicks(start, start + 20_000, 5)).toEqual([{ value: start, label: TIME_LABEL.format(start) }]);
    });

    it('never offers more ticks than asked for', () => {
        for (const span of [30 * MINUTE, 7 * HOUR, 2 * DAY, 40 * DAY, 800 * DAY]) {
            expect(timeTicks(midnight(0) + 1_234, midnight(0) + 1_234 + span, 6).length).toBeLessThanOrEqual(6);
        }
    });
});
