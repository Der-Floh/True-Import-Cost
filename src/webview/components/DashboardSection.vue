<template>
    <section class="section" :aria-labelledby="headingId">
        <div class="section__header">
            <div class="section__heading">
                <h2 :id="headingId" class="section__title">{{ title }}</h2>
                <p v-if="$slots.description" class="section__description">
                    <slot name="description" />
                </p>
            </div>
            <div v-if="$slots.actions" class="section__actions">
                <slot name="actions" />
            </div>
        </div>
        <slot />
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
    readonly id: string;
    readonly title: string;
}>();

const headingId = computed(() => `${props.id}-heading`);
</script>

<style scoped>
.section {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    min-width: 0;
}

.section__header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8px var(--gap);
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
}

.section__heading {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.section__title {
    font-size: 15px;
    font-weight: 600;
}

.section__description {
    color: var(--tone-muted);
    font-size: 12px;
}

.section__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
</style>
