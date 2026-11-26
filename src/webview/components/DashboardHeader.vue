<template>
    <header class="header">
        <div class="header__top">
            <div class="header__identity">
                <h1 class="header__title">{{ selected.id }}</h1>
                <div class="header__tags">
                    <span class="tag" title="Bundler">{{ selected.bundler }}</span>
                    <span v-if="selected.mode !== undefined" class="tag" :title="modeTitle">{{ selected.mode }}</span>
                    <span v-if="selected.estimated" class="tag tag--warn" :title="ESTIMATED_TITLE">Estimated sizes</span>
                </div>
            </div>
            <label class="picker">
                <span class="picker__label">Build target</span>
                <select :value="chosen" class="select picker__select" @change="choose">
                    <option v-for="target in targets" :key="target.key" :value="target.key">{{ optionText(target) }}</option>
                </select>
            </label>
        </div>

        <p class="header__meta">
            <span :title="formatDateTime(selected.createdAt)">Built {{ builtAge }}</span>
            <span class="header__separator" aria-hidden="true">·</span>
            <span class="mono header__path" :title="selected.metadataPath">{{ selected.metadataPath }}</span>
        </p>

        <div v-if="failure !== undefined" class="notice" role="status">
            <CodiconIcon name="warning" class="notice__icon" />
            <p>
                <strong>The latest build metadata of this target could not be read.</strong>
                The dashboard shows the last build that could be read.
                <span class="notice__detail">{{ failure }}</span>
            </p>
        </div>

        <div class="header__bar">
            <div class="header__actions">
                <button type="button" class="button" @click="emit('refresh')">
                    <CodiconIcon name="refresh" />Refresh
                </button>
                <button ref="pinButton" type="button" class="button" @click="emit('pinBaseline')">
                    <CodiconIcon name="pinned" />Pin as baseline
                </button>
                <button type="button" class="button" @click="emit('compareWithFile')">
                    <CodiconIcon name="diff" />Compare with file…
                </button>
            </div>
            <div v-if="selected.baseline !== undefined" class="baseline">
                <p class="baseline__text">
                    Compared with <strong class="baseline__label">{{ selected.baseline.label }}</strong> <span class="muted">({{ baselineSource }}, built {{ baselineAge }})</span>
                </p>
                <button type="button" class="button" @click="emit('clearBaseline')">
                    <CodiconIcon name="close" />Clear baseline
                </button>
            </div>
            <p v-else class="baseline__hint muted">Pin a build as the baseline to see what the next build changes.</p>
        </div>
    </header>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { formatAge, formatBytes } from '../../core/format';
import { useNow } from '../composables/useNow';
import { formatDateTime } from '../format';
import CodiconIcon from './CodiconIcon.vue';

import type { TargetDashboardDto, TargetSummaryDto } from '../../shared/dashboard';

const props = defineProps<{
    readonly targets: readonly TargetSummaryDto[];
    readonly selected: TargetDashboardDto;
}>();

const emit = defineEmits<{
    refresh: [];
    selectTarget: [key: string];
    pinBaseline: [];
    compareWithFile: [];
    clearBaseline: [];
}>();

const ESTIMATED_TITLE = 'Some sizes are estimated from source maps or proportions rather than reported by the bundler.';

const now = useNow();
const chosen = ref(props.selected.key);
const pinButton = ref<HTMLButtonElement | null>(null);

watch(() => props.selected, (selected) => {
    chosen.value = selected.key;
    now.value = Date.now();
});

watch(() => props.selected.baseline, (baseline, previous) => {
    if (baseline === undefined && previous !== undefined && document.activeElement === document.body) {
        pinButton.value?.focus();
    }
}, { flush: 'post' });

const builtAge = computed(() => formatAge(now.value - props.selected.createdAt));
const baselineAge = computed(() => formatAge(now.value - (props.selected.baseline?.createdAt ?? now.value)));
const baselineSource = computed(() => (props.selected.baseline?.source === 'file' ? 'from a file' : 'pinned'));
const failure = computed(() => props.targets.find(target => target.key === props.selected.key)?.failure);
const modeTitle = computed(() => (props.selected.mode === 'development'
    ? 'A development build: production sizes are usually smaller.'
    : 'A production build.'));

function optionText(target: TargetSummaryDto): string {
    const text = `${target.id} · ${formatBytes(target.totalBytes)}`;
    return target.failure === undefined ? text : `${text} · could not be updated`;
}

function choose(event: Event): void {
    const key = (event.target as HTMLSelectElement).value;
    chosen.value = key;
    if (key !== props.selected.key) {
        emit('selectTarget', key);
    }
}
</script>

<style scoped>
.header {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.header__top {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap) 24px;
}

.header__identity {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    min-width: 0;
}

.header__title {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
    overflow-wrap: anywhere;
}

.header__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.picker {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
}

.picker__label {
    color: var(--tone-muted);
    white-space: nowrap;
}

.picker__select {
    min-width: 0;
    max-width: 100%;
}

.header__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
    color: var(--tone-muted);
}

.header__separator {
    opacity: 0.6;
}

.header__path {
    min-width: 0;
}

.notice {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--vscode-inputValidation-warningBorder, var(--tone-warn));
    border-radius: var(--radius-md);
    background: var(--vscode-inputValidation-warningBackground, transparent);
}

.notice__icon {
    margin-top: 1px;
    color: var(--tone-warn);
}

.notice__detail {
    display: block;
    margin-top: 2px;
    color: var(--tone-muted);
    overflow-wrap: anywhere;
}

.header__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 24px;
}

.header__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.baseline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-width: 0;
}

.baseline__text {
    overflow-wrap: anywhere;
}

.baseline__hint {
    font-size: 12px;
}
</style>
