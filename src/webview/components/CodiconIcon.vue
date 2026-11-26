<template>
    <span class="codicon" aria-hidden="true" v-html="svg" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import arrowDown from '@vscode/codicons/src/icons/arrow-down.svg?raw';
import arrowUp from '@vscode/codicons/src/icons/arrow-up.svg?raw';
import chevronRight from '@vscode/codicons/src/icons/chevron-right.svg?raw';
import close from '@vscode/codicons/src/icons/close.svg?raw';
import diff from '@vscode/codicons/src/icons/diff.svg?raw';
import loading from '@vscode/codicons/src/icons/loading.svg?raw';
import pass from '@vscode/codicons/src/icons/pass.svg?raw';
import pinned from '@vscode/codicons/src/icons/pinned.svg?raw';
import question from '@vscode/codicons/src/icons/question.svg?raw';
import references from '@vscode/codicons/src/icons/references.svg?raw';
import refresh from '@vscode/codicons/src/icons/refresh.svg?raw';
import search from '@vscode/codicons/src/icons/search.svg?raw';
import trash from '@vscode/codicons/src/icons/trash.svg?raw';
import warning from '@vscode/codicons/src/icons/warning.svg?raw';

import type { PropType } from 'vue';

const ICONS = {
    'arrow-down': arrowDown,
    'arrow-up': arrowUp,
    'chevron-right': chevronRight,
    close,
    diff,
    loading,
    pass,
    pinned,
    question,
    references,
    refresh,
    search,
    trash,
    warning,
} as const;

const props = defineProps({
    name: { type: String as PropType<keyof typeof ICONS>, required: true },
});

const svg = computed(() => ICONS[props.name]);
</script>

<style scoped>
.codicon {
    display: inline-flex;
    flex: none;
    width: 16px;
    height: 16px;
}

.codicon :deep(svg) {
    display: block;
    width: 100%;
    height: 100%;
}
</style>
