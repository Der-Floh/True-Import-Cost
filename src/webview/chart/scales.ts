const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ZOOM_THRESHOLD = 0.25;

const TIME_STEPS = [MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR];
const DAY_STEPS = [1, 2, 7, 14, 30, 91, 365];

const DAY_LABEL = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const DAY_HOUR_LABEL = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
const TIME_LABEL = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export interface Tick {
    readonly value: number;
    readonly label: string;
}

export function linearScale(domain: readonly [number, number], range: readonly [number, number]): (value: number) => number {
    const [start, end] = domain;
    const [low, high] = range;
    const span = end - start;
    if (!(span > 0)) {
        return () => (low + high) / 2;
    }
    return value => low + ((value - start) / span) * (high - low);
}

export function niceStep(span: number, count: number): number {
    const rough = span / Math.max(1, count);
    const power = 10 ** Math.floor(Math.log10(rough));
    const error = rough / power;
    const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1;
    return factor * power;
}

export function valueTicks(min: number, max: number, count: number): number[] {
    if (!Number.isFinite(max) || max <= 0) {
        return [0, 1000];
    }
    const floor = Number.isFinite(min) && min > max * ZOOM_THRESHOLD ? min : 0;
    const step = niceStep(max > floor ? max - floor : max, count);
    const low = Math.floor(floor / step) * step;
    const steps = Math.max(1, Math.ceil((max - low) / step - 1e-9));
    return Array.from({ length: steps + 1 }, (_, index) => low + index * step);
}

function startOfDay(timestamp: number): Date {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date;
}

function sameDay(a: number, b: number): boolean {
    return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function hourTicks(start: number, end: number, step: number): number[] {
    const midnight = startOfDay(start).getTime();
    const values: number[] = [];
    for (let tick = midnight + Math.ceil((start - midnight) / step) * step; tick <= end; tick += step) {
        values.push(tick);
    }
    return values;
}

function dayTicks(start: number, end: number, days: number): number[] {
    const date = startOfDay(start);
    if (date.getTime() < start) {
        date.setDate(date.getDate() + 1);
    }
    const values: number[] = [];
    while (date.getTime() <= end) {
        values.push(date.getTime());
        date.setDate(date.getDate() + days);
    }
    return values;
}

function ticksFor(start: number, end: number, count: number): Tick[] {
    const span = end - start;
    const step = TIME_STEPS.find(candidate => span / candidate <= count);
    if (step === undefined) {
        const days = DAY_STEPS.find(candidate => span / (candidate * DAY) <= count) ?? 365;
        return dayTicks(start, end, days).map(value => ({ value, label: DAY_LABEL.format(value) }));
    }
    const format = sameDay(start, end) ? TIME_LABEL : DAY_HOUR_LABEL;
    return hourTicks(start, end, step).map(value => ({ value, label: format.format(value) }));
}

export function timeTicks(start: number, end: number, maxCount: number): Tick[] {
    const ticks = end > start ? ticksFor(start, end, Math.max(1, Math.floor(maxCount))) : [];
    return ticks.length > 0 ? ticks : [{ value: start, label: (end - start < DAY ? TIME_LABEL : DAY_LABEL).format(start) }];
}
