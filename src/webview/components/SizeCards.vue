<template>
    <section class="sizes" aria-labelledby="sizes-heading">
        <h2 id="sizes-heading" class="sr-only">Sizes</h2>
        <dl class="sizes__grid">
            <div v-for="card in cards" :key="card.key" class="card" :class="{ 'card--over': card.budget?.exceeded === true }">
                <dt class="card__label">{{ card.label }}</dt>
                <dd class="card__value">{{ formatBytes(card.bytes) }}</dd>
                <dd v-if="card.share !== undefined" class="card__note">{{ card.share }}</dd>
                <dd v-if="card.delta !== undefined" class="card__delta" :class="`tone-${deltaTone(card.delta)}`" :title="card.deltaTitle">
                    <CodiconIcon v-if="card.delta !== 0" :name="card.delta > 0 ? 'arrow-up' : 'arrow-down'" class="card__icon" />
                    <span>{{ describeDelta(card.delta) }}</span>
                </dd>
                <dd v-if="card.budget !== undefined" class="card__budget" :class="card.budget.exceeded ? 'tone-bad' : 'muted'" :title="`${card.budget.label}: ${describeBudget(card.budget)}`">
                    <CodiconIcon v-if="card.budget.exceeded" name="warning" class="card__icon" />
                    <span>{{ card.budget.exceeded ? 'Over' : 'Within' }} {{ formatBytes(card.budget.limit) }} budget</span>
                </dd>
            </div>
        </dl>
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { formatBytes } from '../../core/format';
import { deltaTone, deltaWord, describeBudget, describeDelta, formatShare } from '../format';
import CodiconIcon from './CodiconIcon.vue';

import type { BudgetKindDto, BudgetStateDto, SizeTotalsDto } from '../../shared/dashboard';

const props = defineProps<{
    readonly totals: SizeTotalsDto;
    readonly baseline: SizeTotalsDto | null;
    readonly budgets: readonly BudgetStateDto[];
}>();

interface CardSpec {
    readonly key: keyof SizeTotalsDto;
    readonly label: string;
    readonly budget?: BudgetKindDto;
    readonly shareOf?: 'total' | 'code';
}

const SPECS: readonly CardSpec[] = [
    { key: 'total', label: 'Total', budget: 'total' },
    { key: 'javascript', label: 'JavaScript', budget: 'javascript', shareOf: 'total' },
    { key: 'css', label: 'CSS', budget: 'css', shareOf: 'total' },
    { key: 'assets', label: 'Other assets', shareOf: 'total' },
    { key: 'initial', label: 'Initial load', budget: 'initial', shareOf: 'code' },
    { key: 'lazy', label: 'Lazy', shareOf: 'code' },
];

const cards = computed(() => SPECS.map((spec) => {
    const bytes = props.totals[spec.key];
    const before = props.baseline?.[spec.key];
    const delta = before === undefined ? undefined : bytes - before;
    const code = props.totals.initial + props.totals.lazy;
    return {
        key: spec.key,
        label: spec.label,
        bytes,
        share: spec.shareOf === 'total'
            ? `${formatShare(bytes, props.totals.total)} of total`
            : spec.shareOf === 'code' ? `${formatShare(bytes, code)} of JS and CSS` : undefined,
        delta,
        deltaTitle: before === undefined || delta === undefined ? undefined : deltaTitle(delta, before),
        budget: spec.budget === undefined ? undefined : props.budgets.find(budget => budget.kind === spec.budget),
    };
}));

function deltaTitle(delta: number, before: number): string {
    return delta === 0
        ? `The same as the baseline, ${formatBytes(before)}`
        : `${formatBytes(Math.abs(delta))} ${deltaWord(delta)} than the baseline, which had ${formatBytes(before)}`;
}

</script>

<style scoped>
.sizes__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
    margin: 0;
}

.card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
}

.card--over {
    border-color: color-mix(in srgb, var(--tone-bad) 55%, var(--border));
}

.card dd {
    margin: 0;
}

.card__label {
    color: var(--tone-muted);
    font-size: 12px;
}

.card__value {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
}

.card__note {
    color: var(--tone-muted);
    font-size: 12px;
}

.card__delta,
.card__budget {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
}

.card__icon {
    width: 14px;
    height: 14px;
}
</style>
