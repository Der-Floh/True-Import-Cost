<template>
    <DashboardSection id="duplicates" title="Duplicated packages">
        <template #description>Packages bundled more than once, in different versions or from different install locations.</template>
        <ul class="duplicates">
            <li v-for="duplicate in duplicates" :key="duplicate.name" class="duplicate">
                <div class="duplicate__head">
                    <span class="duplicate__name">{{ duplicate.name }}</span>
                    <span class="muted">{{ plural(duplicate.instances.length, 'copy', 'copies') }}, {{ formatBytes(duplicate.bytes) }} in all</span>
                    <button
                        type="button"
                        class="icon-button duplicate__explain"
                        :aria-label="`Explain why ${duplicate.name} is included`"
                        :title="`Explain why ${duplicate.name} is included`"
                        @click="emit('explain', duplicate.name)"
                    >
                        <CodiconIcon name="question" />
                    </button>
                </div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th scope="col">Version</th>
                            <th scope="col">Installed at</th>
                            <th scope="col" class="num">Size</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="instance in duplicate.instances" :key="instance.root">
                            <td class="duplicate__version">{{ instance.version ?? 'unknown' }}</td>
                            <td class="mono">{{ instance.root }}</td>
                            <td class="num">{{ formatBytes(instance.bytes) }}</td>
                        </tr>
                    </tbody>
                </table>
            </li>
        </ul>
    </DashboardSection>
</template>

<script setup lang="ts">
import { formatBytes } from '../../core/format';
import { plural } from '../format';
import CodiconIcon from './CodiconIcon.vue';
import DashboardSection from './DashboardSection.vue';

import type { DuplicateDto } from '../../shared/dashboard';

defineProps<{
    readonly duplicates: readonly DuplicateDto[];
}>();

const emit = defineEmits<{
    explain: [packageName: string];
}>();
</script>

<style scoped>
.duplicates {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.duplicate__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    margin-bottom: 4px;
}

.duplicate__name {
    font-weight: 600;
    overflow-wrap: anywhere;
}

.duplicate__explain {
    margin-left: auto;
}

.duplicate__version {
    white-space: nowrap;
}
</style>
