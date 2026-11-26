import { formatBytes } from '../core/format';

import type { BudgetStateDto } from '../shared/dashboard';

export type Tone = 'good' | 'bad' | 'neutral';

const MINUS_SIGN = '\u2212';

const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDelta(delta: number): string {
    if (!Number.isFinite(delta) || delta === 0) {
        return 'no change';
    }
    return `${delta > 0 ? '+' : MINUS_SIGN}${formatBytes(Math.abs(delta))}`;
}

export function deltaTone(delta: number): Tone {
    if (!Number.isFinite(delta) || delta === 0) {
        return 'neutral';
    }
    return delta > 0 ? 'bad' : 'good';
}

export function deltaWord(delta: number): string {
    if (!Number.isFinite(delta) || delta === 0) {
        return '';
    }
    return delta > 0 ? 'larger' : 'smaller';
}

export function describeDelta(delta: number): string {
    const word = deltaWord(delta);
    return word === '' ? formatDelta(delta) : `${formatDelta(delta)} ${word}`;
}

export function describeBudget(budget: BudgetStateDto): string {
    const difference = formatBytes(Math.abs(budget.actual - budget.limit));
    return `${formatBytes(budget.actual)}, ${difference} ${budget.exceeded ? 'over' : 'under'} the budget of ${formatBytes(budget.limit)}`;
}

export function formatShare(part: number, whole: number): string {
    if (!(whole > 0) || !(part > 0)) {
        return '0%';
    }
    const percent = (part / whole) * 100;
    return percent < 1 ? '<1%' : `${Math.round(percent)}%`;
}

export function formatDateTime(timestamp: number): string {
    return DATE_TIME.format(timestamp);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}
