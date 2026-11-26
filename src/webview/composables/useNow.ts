import { onMounted, onUnmounted, ref } from 'vue';

import type { Ref } from 'vue';

export function useNow(intervalMs = 30_000): Ref<number> {
    const now = ref(Date.now());
    let timer: ReturnType<typeof setInterval> | undefined;

    onMounted(() => {
        timer = setInterval(() => {
            now.value = Date.now();
        }, intervalMs);
    });

    onUnmounted(() => {
        clearInterval(timer);
    });

    return now;
}
