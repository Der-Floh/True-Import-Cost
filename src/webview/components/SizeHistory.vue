<template>
    <DashboardSection id="history" title="Size history">
        <template #description>Total and initial load of the builds recorded for this target.</template>
        <template v-if="points.length > 0" #actions>
            <button type="button" class="button" @click="emit('clearHistory')">
                <CodiconIcon name="trash" />Clear history
            </button>
        </template>
        <HistoryChart v-if="sorted.length >= 2" :points="sorted" />
        <p v-else class="empty">Size history appears once a few builds have been recorded.</p>
    </DashboardSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import CodiconIcon from './CodiconIcon.vue';
import DashboardSection from './DashboardSection.vue';
import HistoryChart from './HistoryChart.vue';

import type { HistoryPointDto } from '../../shared/dashboard';

const props = defineProps<{
    readonly points: readonly HistoryPointDto[];
}>();

const emit = defineEmits<{
    clearHistory: [];
}>();

const sorted = computed(() => [...props.points].sort((a, b) => a.createdAt - b.createdAt));
</script>
