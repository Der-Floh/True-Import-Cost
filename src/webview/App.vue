<template>
    <main class="dashboard" :aria-busy="model === undefined ? 'true' : 'false'">
        <div v-if="model === undefined" class="state" role="status">
            <CodiconIcon name="loading" class="state__spinner" />
            <p>Reading the build…</p>
        </div>

        <section v-else-if="selected === undefined" class="state state--empty" aria-labelledby="empty-heading">
            <h1 id="empty-heading" class="state__title">No build metadata yet</h1>
            <p>
                Write an esbuild metafile into a <code>.true-import-cost</code> folder, or add the
                <code>@true-import-cost/vite</code> or <code>@true-import-cost/esbuild</code> plugin to your build.
            </p>
            <ul v-if="failures.length > 0" class="state__failures">
                <li v-for="target in failures" :key="target.key">
                    <strong>{{ target.id }}</strong>: {{ target.failure }}
                </li>
            </ul>
            <button type="button" class="button button--primary" @click="refresh">
                <CodiconIcon name="refresh" />Refresh
            </button>
        </section>

        <template v-else>
            <DashboardHeader
                :targets="model.targets"
                :selected="selected"
                @refresh="refresh"
                @select-target="selectTarget"
                @pin-baseline="onSelected(pinBaseline)"
                @compare-with-file="onSelected(compareWithFile)"
                @clear-baseline="onSelected(clearBaseline)"
            />
            <SizeCards :totals="selected.totals" :baseline="selected.baseline?.totals ?? null" :budgets="selected.budgets" />
            <BundleTreemap
                :key="selected.key"
                :root="selected.treemap"
                @open-module="openSelectedModule"
                @explain="explainPackage"
                @show-importers="showPackageImporters"
            />
            <PackagesTable
                :packages="selected.packages"
                :has-baseline="selected.baseline !== undefined"
                @explain="explainPackage"
                @show-importers="showPackageImporters"
            />
            <ChunksAssets
                v-if="selected.chunks.length > 0 || selected.assets.length > 0"
                :chunks="selected.chunks"
                :assets="selected.assets"
                :has-baseline="selected.baseline !== undefined"
            />
            <div v-if="selected.duplicates.length > 0 || selected.budgets.length > 0" class="dashboard__pair">
                <DuplicatesList v-if="selected.duplicates.length > 0" :duplicates="selected.duplicates" @explain="explainPackage" />
                <BudgetsList v-if="selected.budgets.length > 0" :budgets="selected.budgets" />
            </div>
            <ModuleChanges v-if="selected.baseline !== undefined" :changes="selected.moduleChanges" />
            <SizeHistory v-if="model.historyEnabled" :points="selected.history" @clear-history="onSelected(clearHistory)" />
            <TargetComparison v-if="model.comparison !== undefined" :comparison="model.comparison" :selected-key="selected.key" />
        </template>
    </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import BudgetsList from './components/BudgetsList.vue';
import BundleTreemap from './components/BundleTreemap.vue';
import ChunksAssets from './components/ChunksAssets.vue';
import CodiconIcon from './components/CodiconIcon.vue';
import DashboardHeader from './components/DashboardHeader.vue';
import DuplicatesList from './components/DuplicatesList.vue';
import ModuleChanges from './components/ModuleChanges.vue';
import PackagesTable from './components/PackagesTable.vue';
import SizeCards from './components/SizeCards.vue';
import SizeHistory from './components/SizeHistory.vue';
import TargetComparison from './components/TargetComparison.vue';
import { useDashboard } from './composables/useDashboard';

const {
    model,
    refresh,
    selectTarget,
    openModule,
    explain,
    showImporters,
    pinBaseline,
    compareWithFile,
    clearBaseline,
    clearHistory,
} = useDashboard();

const selected = computed(() => model.value?.selected);
const failures = computed(() => (model.value?.targets ?? []).filter(target => target.failure !== undefined));

function onSelected(action: (target: string) => void): void {
    if (selected.value !== undefined) {
        action(selected.value.key);
    }
}

function openSelectedModule(moduleId: string): void {
    if (selected.value !== undefined) {
        openModule(selected.value.key, moduleId);
    }
}

function explainPackage(packageName: string): void {
    if (selected.value !== undefined) {
        explain({ target: selected.value.key, packageName });
    }
}

function showPackageImporters(packageName: string): void {
    if (selected.value !== undefined) {
        showImporters({ target: selected.value.key, packageName });
    }
}
</script>

<style scoped>
.dashboard {
    display: flex;
    flex-direction: column;
    gap: 32px;
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px 24px 48px;
}

.dashboard__pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
    align-items: start;
    gap: 32px 40px;
}

.state {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    max-width: 640px;
    padding-top: 12px;
}

.state[role='status'] {
    flex-direction: row;
    align-items: center;
    color: var(--tone-muted);
}

.state__spinner {
    animation: spin 1.2s linear infinite;
}

.state__title {
    font-size: 20px;
    font-weight: 600;
}

.state__failures {
    margin: 0;
    padding-left: 18px;
    color: var(--tone-muted);
    overflow-wrap: anywhere;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

@media (max-width: 520px) {
    .dashboard {
        gap: 28px;
        padding: 16px 16px 40px;
    }
}
</style>
