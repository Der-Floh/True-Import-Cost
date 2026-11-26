import { computed, ref, toValue } from 'vue';

import type { ComputedRef, MaybeRefOrGetter } from 'vue';

export interface RowLimit<T> {
    readonly visible: ComputedRef<readonly T[]>;
    readonly hidden: ComputedRef<number>;
    readonly showAll: () => void;
}

export function useRowLimit<T>(rows: MaybeRefOrGetter<readonly T[]>, limit: number): RowLimit<T> {
    const expanded = ref(false);
    const visible = computed(() => {
        const all = toValue(rows);
        return expanded.value ? all : all.slice(0, limit);
    });
    const hidden = computed(() => toValue(rows).length - visible.value.length);
    return {
        visible,
        hidden,
        showAll: () => {
            expanded.value = true;
        },
    };
}
