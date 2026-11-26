<template>
    <DashboardSection id="budgets" title="Budgets">
        <template #description>Size limits from the <code>trueImportCost.budgets</code> setting.</template>
        <ul class="budgets">
            <li v-for="budget in rows" :key="`${budget.kind}:${budget.label}`" class="budget">
                <div class="budget__head">
                    <span class="budget__label">
                        {{ budget.label }}
                        <span v-if="budget.kind === 'package'" class="muted budget__kind">package</span>
                    </span>
                    <span class="budget__figure">{{ formatBytes(budget.actual) }} of {{ formatBytes(budget.limit) }}</span>
                </div>
                <div class="meter" :class="budget.exceeded ? 'meter--over' : 'meter--within'" aria-hidden="true">
                    <span class="meter__fill" :style="{ width: budget.fill }" />
                    <span v-if="budget.exceeded" class="meter__limit" :style="{ left: budget.limitAt }" />
                </div>
                <p class="budget__status" :class="budget.exceeded ? 'tone-bad' : 'tone-good'">
                    <CodiconIcon :name="budget.exceeded ? 'warning' : 'pass'" class="budget__icon" />
                    {{ budget.status }}
                </p>
            </li>
        </ul>
    </DashboardSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { formatBytes } from '../../core/format';
import CodiconIcon from './CodiconIcon.vue';
import DashboardSection from './DashboardSection.vue';

import type { BudgetStateDto } from '../../shared/dashboard';

const props = defineProps<{
    readonly budgets: readonly BudgetStateDto[];
}>();

function percent(value: number): string {
    return `${Math.max(0, Math.min(100, value * 100)).toFixed(2)}%`;
}

const rows = computed(() => props.budgets.map((budget) => {
    const scale = Math.max(budget.limit, budget.actual, 1);
    const difference = Math.abs(budget.actual - budget.limit);
    return {
        ...budget,
        fill: percent(budget.actual / scale),
        limitAt: percent(budget.limit / scale),
        status: budget.exceeded ? `Exceeded by ${formatBytes(difference)}` : `Within budget, ${formatBytes(difference)} to spare`,
    };
}));
</script>

<style scoped>
.budgets {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.budget {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.budget__head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 2px 12px;
}

.budget__label {
    font-weight: 600;
    overflow-wrap: anywhere;
}

.budget__kind {
    margin-left: 4px;
    font-size: 12px;
    font-weight: normal;
}

.budget__figure {
    font-variant-numeric: tabular-nums;
}

.meter {
    --meter-color: var(--tone-good);
    position: relative;
    height: 8px;
    overflow: hidden;
    border-radius: 4px;
    background: color-mix(in srgb, var(--meter-color) 22%, var(--surface));
}

.meter--over {
    --meter-color: var(--tone-bad);
}

.meter__fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 4px;
    background: var(--meter-color);
}

.meter__limit {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--surface);
}

.budget__status {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
}

.budget__icon {
    width: 14px;
    height: 14px;
}
</style>
