<template>
    <figure class="history">
        <ul class="legend">
            <li class="legend__item">
                <span class="legend__key legend__key--total" />Total <span class="legend__value">{{ formatBytes(latest.total) }}</span>
            </li>
            <li class="legend__item">
                <span class="legend__key legend__key--initial" />Initial load <span class="legend__value">{{ formatBytes(latest.initial) }}</span>
            </li>
        </ul>
        <div ref="frame" class="history__frame">
            <svg class="history__chart" :viewBox="`0 0 ${width} ${HEIGHT}`" role="img" :aria-label="summary">
                <g class="axis">
                    <g v-for="tick in yTicks" :key="tick.value">
                        <line
                            class="axis__grid"
                            :class="{ 'axis__grid--base': tick.value === yValues[0] }"
                            :x1="PLOT.left"
                            :x2="width - PLOT.right"
                            :y1="tick.y"
                            :y2="tick.y"
                        />
                        <text class="axis__label" :x="PLOT.left - 8" :y="tick.y" dy="0.32em" text-anchor="end">{{ tick.label }}</text>
                    </g>
                    <text
                        v-for="tick in xTicks"
                        :key="tick.value"
                        class="axis__label"
                        :x="tick.x"
                        :y="HEIGHT - 6"
                        :text-anchor="tick.anchor"
                    >
                        {{ tick.label }}
                    </text>
                </g>
                <path class="series__line series__line--total" :d="linePath('total')" />
                <path class="series__line series__line--initial" :d="linePath('initial')" />
                <g v-for="point in plotted" :key="point.key" class="point">
                    <title>{{ point.title }}</title>
                    <rect class="point__hit" :x="point.hitX" :y="PLOT.top" :width="point.hitWidth" :height="plotHeight" />
                    <line class="point__guide" :x1="point.x" :x2="point.x" :y1="PLOT.top" :y2="HEIGHT - PLOT.bottom" />
                    <circle class="point__dot point__dot--total" :cx="point.x" :cy="point.totalY" r="3.5" />
                    <circle class="point__dot point__dot--initial" :cx="point.x" :cy="point.initialY" r="3.5" />
                </g>
            </svg>
        </div>
        <button
            type="button"
            class="link-button history__toggle"
            :aria-expanded="showTable ? 'true' : 'false'"
            :aria-controls="showTable ? 'history-table' : undefined"
            @click="showTable = !showTable"
        >
            {{ showTable ? 'Hide the table' : 'Show as a table' }}
        </button>
        <table v-if="showTable" id="history-table" class="data-table history__table">
            <caption class="sr-only">Size of each recorded build, newest first</caption>
            <thead>
                <tr>
                    <th scope="col">Built</th>
                    <th scope="col" class="num">Total</th>
                    <th scope="col" class="num">Initial load</th>
                    <th scope="col" class="num">JavaScript</th>
                    <th scope="col" class="num">CSS</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(point, index) in newestFirst" :key="`${point.createdAt}-${index}`">
                    <th scope="row" class="history__date">{{ formatDateTime(point.createdAt) }}</th>
                    <td class="num">{{ formatBytes(point.total) }}</td>
                    <td class="num">{{ formatBytes(point.initial) }}</td>
                    <td class="num">{{ formatBytes(point.javascript) }}</td>
                    <td class="num">{{ formatBytes(point.css) }}</td>
                </tr>
            </tbody>
        </table>
    </figure>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { formatBytes } from '../../core/format';
import { linearScale, timeTicks, valueTicks } from '../chart/scales';
import { useElementWidth } from '../composables/useElementWidth';
import { formatDateTime } from '../format';

import type { HistoryPointDto } from '../../shared/dashboard';

const props = defineProps<{
    readonly points: readonly HistoryPointDto[];
}>();

const HEIGHT = 220;
const PLOT = { top: 12, right: 16, bottom: 28, left: 64 } as const;
const EDGE = 28;

const frame = ref<HTMLElement | null>(null);
const width = useElementWidth(frame, 720);
const showTable = ref(false);

const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;

const first = computed(() => props.points[0] ?? { createdAt: 0, total: 0, javascript: 0, css: 0, initial: 0 });
const latest = computed(() => props.points.at(-1) ?? first.value);
const newestFirst = computed(() => [...props.points].reverse());

const yValues = computed(() => {
    const values = props.points.flatMap(point => [point.total, point.initial]);
    return valueTicks(Math.min(...values), Math.max(...values), 4);
});
const yScale = computed(() => linearScale([yValues.value[0] ?? 0, yValues.value.at(-1) ?? 1], [HEIGHT - PLOT.bottom, PLOT.top]));
const xScale = computed(() => linearScale([first.value.createdAt, latest.value.createdAt], [PLOT.left, width.value - PLOT.right]));

const yTicks = computed(() => yValues.value.map(value => ({ value, y: yScale.value(value), label: formatBytes(value) })));

const xTicks = computed(() => {
    const right = width.value - PLOT.right;
    const count = Math.max(2, Math.floor((right - PLOT.left) / 96));
    return timeTicks(first.value.createdAt, latest.value.createdAt, count).map((tick) => {
        const x = xScale.value(tick.value);
        const anchor = x - PLOT.left < EDGE ? 'start' : right - x < EDGE ? 'end' : 'middle';
        return { ...tick, x, anchor };
    });
});

const plotted = computed(() => {
    const xs = props.points.map(point => xScale.value(point.createdAt));
    return props.points.map((point, index) => {
        const x = xs[index] ?? PLOT.left;
        const start = index === 0 ? PLOT.left : (x + (xs[index - 1] ?? x)) / 2;
        const end = index === xs.length - 1 ? width.value - PLOT.right : (x + (xs[index + 1] ?? x)) / 2;
        return {
            key: `${point.createdAt}-${index}`,
            x,
            totalY: yScale.value(point.total),
            initialY: yScale.value(point.initial),
            hitX: start,
            hitWidth: Math.max(1, end - start),
            title: `${formatDateTime(point.createdAt)}\nTotal: ${formatBytes(point.total)}\nInitial load: ${formatBytes(point.initial)}`,
        };
    });
});

const summary = computed(() => [
    `Size history of ${props.points.length} builds, from ${formatDateTime(first.value.createdAt)} to ${formatDateTime(latest.value.createdAt)}.`,
    `Total went from ${formatBytes(first.value.total)} to ${formatBytes(latest.value.total)},`,
    `initial load from ${formatBytes(first.value.initial)} to ${formatBytes(latest.value.initial)}.`,
].join(' '));

function linePath(series: 'total' | 'initial'): string {
    return plotted.value
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${series === 'total' ? point.totalY : point.initialY}`)
        .join(' ');
}
</script>

<style scoped>
.history {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
}

.legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 20px;
    margin: 0;
    padding: 0;
    font-size: 12px;
    list-style: none;
}

.legend__item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--tone-muted);
}

.legend__key {
    width: 16px;
    height: 2px;
    border-radius: 1px;
    background: var(--series-color);
}

.legend__key--total,
.series__line--total,
.point__dot--total {
    --series-color: var(--vscode-charts-blue);
}

.legend__key--initial,
.series__line--initial,
.point__dot--initial {
    --series-color: var(--vscode-charts-orange);
}

.legend__value {
    color: var(--vscode-foreground);
    font-weight: 600;
}

.history__frame {
    min-width: 0;
}

.history__chart {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
}

.axis__grid {
    stroke: var(--border-subtle);
    stroke-width: 1;
    shape-rendering: crispEdges;
}

.axis__grid--base {
    stroke: var(--border);
}

.axis__label {
    fill: var(--tone-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
}

.series__line {
    fill: none;
    stroke: var(--series-color);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.point__hit {
    fill: transparent;
}

.point__guide {
    stroke: var(--tone-muted);
    stroke-width: 1;
    opacity: 0;
    shape-rendering: crispEdges;
}

.point:hover .point__guide {
    opacity: 0.6;
}

.point__dot {
    fill: var(--series-color);
    stroke: var(--surface);
    stroke-width: 2;
}

.point:hover .point__dot {
    r: 5;
}

.history__toggle {
    align-self: flex-start;
    font-size: 12px;
}

.history__table {
    width: auto;
    min-width: min(100%, 560px);
}

.history__table :is(th, td) + :is(th, td) {
    padding-left: 24px;
}

.history__date {
    font-weight: normal;
    white-space: nowrap;
}
</style>
