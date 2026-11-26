import { describe, expect, it } from 'vitest';

import { formatAge, formatBytes } from '../../core/format';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatBytes', () => {
    it('shows counts below 1000 as whole bytes', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(1)).toBe('1 B');
        expect(formatBytes(999)).toBe('999 B');
    });

    it('uses decimal kilobytes with one decimal below 100 kB', () => {
        expect(formatBytes(1000)).toBe('1 kB');
        expect(formatBytes(1234)).toBe('1.2 kB');
        expect(formatBytes(12_345)).toBe('12.3 kB');
        expect(formatBytes(99_940)).toBe('99.9 kB');
    });

    it('drops the decimal from 100 kB on', () => {
        expect(formatBytes(100_000)).toBe('100 kB');
        expect(formatBytes(123_456)).toBe('123 kB');
        expect(formatBytes(999_499)).toBe('999 kB');
    });

    it('switches to megabytes rather than showing 1000 kB', () => {
        expect(formatBytes(999_500)).toBe('1 MB');
        expect(formatBytes(1_234_567)).toBe('1.23 MB');
        expect(formatBytes(45_670_000)).toBe('45.7 MB');
        expect(formatBytes(456_700_000)).toBe('457 MB');
    });

    it('stops at gigabytes', () => {
        expect(formatBytes(2_500_000_000)).toBe('2.5 GB');
        expect(formatBytes(5_000_000_000_000)).toBe('5000 GB');
    });

    it('trims trailing zeros after the decimal point only', () => {
        expect(formatBytes(10_000)).toBe('10 kB');
        expect(formatBytes(2_000_000)).toBe('2 MB');
        expect(formatBytes(1_100_000)).toBe('1.1 MB');
        expect(formatBytes(1_050_000)).toBe('1.05 MB');
    });

    it('shows negative and non-finite counts as 0 B', () => {
        expect(formatBytes(-5)).toBe('0 B');
        expect(formatBytes(Number.NaN)).toBe('0 B');
        expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
    });
});

describe('formatAge', () => {
    it('says "just now" for anything under 45 seconds, including clock skew', () => {
        expect(formatAge(0)).toBe('just now');
        expect(formatAge(44 * SECOND)).toBe('just now');
        expect(formatAge(-5 * MINUTE)).toBe('just now');
    });

    it('rounds to minutes below an hour', () => {
        expect(formatAge(45 * SECOND)).toBe('1 minute ago');
        expect(formatAge(90 * SECOND)).toBe('2 minutes ago');
        expect(formatAge(59 * MINUTE)).toBe('59 minutes ago');
    });

    it('rounds to hours below a day', () => {
        expect(formatAge(59.5 * MINUTE)).toBe('1 hour ago');
        expect(formatAge(3 * HOUR)).toBe('3 hours ago');
    });

    it('rounds to days from then on', () => {
        expect(formatAge(23.5 * HOUR)).toBe('1 day ago');
        expect(formatAge(3 * DAY)).toBe('3 days ago');
        expect(formatAge(400 * DAY)).toBe('400 days ago');
    });
});
