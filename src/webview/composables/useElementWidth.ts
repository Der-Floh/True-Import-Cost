import { onUnmounted, ref, watch } from 'vue';

import type { Ref } from 'vue';

export function useElementWidth(element: Readonly<Ref<HTMLElement | null>>, fallback: number): Ref<number> {
    const width = ref(fallback);
    let observer: ResizeObserver | undefined;

    const update = (measured: number): void => {
        if (measured > 0) {
            width.value = Math.floor(measured);
        }
    };

    watch(element, (current) => {
        observer?.disconnect();
        observer = undefined;
        if (current === null) {
            return;
        }
        update(current.clientWidth);
        if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    update(entry.contentRect.width);
                }
            });
            observer.observe(current);
        }
    }, { immediate: true, flush: 'post' });

    onUnmounted(() => {
        observer?.disconnect();
    });

    return width;
}
