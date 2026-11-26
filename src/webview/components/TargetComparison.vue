<template>
    <DashboardSection id="comparison" title="Packages across build targets">
        <template #description>How many bytes each package adds to every build target.</template>
        <p v-if="comparison.rows.length === 0" class="empty">None of the build targets bundles a package from node_modules.</p>
        <template v-else>
            <div class="scroll" role="region" aria-labelledby="comparison-heading" tabindex="0">
                <table class="data-table comparison">
                    <thead>
                        <tr>
                            <th scope="col">Package</th>
                            <th
                                v-for="target in comparison.targets"
                                :key="target.key"
                                scope="col"
                                class="num"
                                :class="{ 'comparison__selected': target.key === selectedKey }"
                            >
                                {{ target.id }}<span v-if="target.key === selectedKey" class="sr-only"> (this target)</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in visible" :key="row.name">
                            <th scope="row" class="comparison__name">{{ row.name }}</th>
                            <td
                                v-for="(bytes, index) in row.bytes"
                                :key="index"
                                class="num"
                                :class="{ 'comparison__selected': comparison.targets[index]?.key === selectedKey }"
                            >
                                <template v-if="bytes === null">
                                    <span class="muted" aria-hidden="true">–</span><span class="sr-only">not bundled</span>
                                </template>
                                <template v-else>{{ formatBytes(bytes) }}</template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <button v-if="hidden > 0" type="button" class="button show-all" @click="showAll">Show all {{ comparison.rows.length }} packages</button>
        </template>
    </DashboardSection>
</template>

<script setup lang="ts">
import { formatBytes } from '../../core/format';
import { useRowLimit } from '../composables/useRowLimit';
import DashboardSection from './DashboardSection.vue';

import type { TargetComparisonDto } from '../../shared/dashboard';

const props = defineProps<{
    readonly comparison: TargetComparisonDto;
    readonly selectedKey: string;
}>();

const ROW_LIMIT = 100;

const { visible, hidden, showAll } = useRowLimit(() => props.comparison.rows, ROW_LIMIT);
</script>

<style scoped>
.scroll {
    min-width: 0;
    overflow-x: auto;
}

.comparison {
    width: auto;
    min-width: min(100%, 560px);
}

.comparison th[scope='row'] {
    font-weight: normal;
}

.comparison__name {
    min-width: 140px;
    padding-right: 32px;
    overflow-wrap: anywhere;
}

.comparison__selected {
    background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
}

thead .comparison__selected {
    color: var(--vscode-foreground);
}

.show-all {
    align-self: flex-start;
}
</style>
