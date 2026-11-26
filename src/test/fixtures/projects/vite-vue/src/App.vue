<script setup lang="ts">
import { computed, ref } from 'vue';
import { format, parse } from 'big-library';
import Hello from './components/Hello.vue';
import Unused from './components/Unused.vue';
import { vFocus } from './directives/focus';
import type { Greeting } from './types';

const count = ref(1);
const greeting: Greeting = { text: 'Hello from the fixture' };
const summary = computed(() => format(parse(`${greeting.text} ${count.value}`)));
const loadLazy = () => import('./components/Lazy.vue');
</script>

<template>
    <main class="layout">
        <Hello v-focus :msg="summary" @click="count++" />
        <button type="button" @click="loadLazy">Load more</button>
    </main>
</template>

<style scoped>
.layout button {
    border: 1px solid #646cff;
    border-radius: 8px;
}
</style>
