<template>
    <main class="dashboard">
        <p v-if="model === undefined" class="placeholder">Reading the build…</p>
        <p v-else-if="model.selected === undefined" class="placeholder">
            No build metadata yet. Write an esbuild metafile into a .true-import-cost folder, or add the
            @true-import-cost/vite or @true-import-cost/esbuild plugin to your build.
        </p>
        <h1 v-else>{{ model.selected.id }}</h1>
    </main>
</template>

<script setup lang="ts">
import { useDashboard } from './composables/useDashboard';

const { model } = useDashboard();
</script>

<style scoped>
.dashboard {
    padding: calc(var(--pad) * 2);
}

.placeholder {
    color: var(--tone-muted);
}
</style>
