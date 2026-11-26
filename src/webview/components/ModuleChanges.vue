<template>
    <DashboardSection id="changes" title="Changes since the baseline">
        <template #description>Modules whose size changed, largest change first.</template>
        <p v-if="sorted.length === 0" class="empty">No module changed size since the baseline.</p>
        <template v-else>
            <table class="data-table changes">
                <thead>
                    <tr>
                        <th scope="col">Module</th>
                        <th scope="col" class="num">Change</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="change in visible" :key="change.id">
                        <th scope="row" class="changes__module">
                            <span class="changes__line">
                                <span class="mono">{{ change.label }}</span>
                                <span v-if="change.before === 0" class="tag">New</span>
                                <span v-else-if="change.after === 0" class="tag">Removed</span>
                            </span>
                            <span class="changes__sizes muted">{{ formatBytes(change.before) }} → {{ formatBytes(change.after) }}</span>
                        </th>
                        <td class="num" :class="`tone-${deltaTone(change.delta)}`">{{ formatDelta(change.delta) }}</td>
                    </tr>
                </tbody>
            </table>
            <button v-if="hidden > 0" type="button" class="button show-all" @click="showAll">Show all {{ sorted.length }} changes</button>
        </template>
    </DashboardSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { formatBytes } from '../../core/format';
import { useRowLimit } from '../composables/useRowLimit';
import { deltaTone, formatDelta } from '../format';
import DashboardSection from './DashboardSection.vue';

import type { ModuleChangeDto } from '../../shared/dashboard';

const props = defineProps<{
    readonly changes: readonly ModuleChangeDto[];
}>();

const ROW_LIMIT = 50;

const sorted = computed(() => [...props.changes].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label)));

const { visible, hidden, showAll } = useRowLimit(sorted, ROW_LIMIT);
</script>

<style scoped>
.changes th[scope='row'] {
    font-weight: normal;
}

.changes__module {
    width: 100%;
}

.changes__line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
}

.changes__sizes {
    display: block;
    font-size: 12px;
}

.show-all {
    align-self: flex-start;
}
</style>
