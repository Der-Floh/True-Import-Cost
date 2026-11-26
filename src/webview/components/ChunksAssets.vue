<template>
    <DashboardSection id="chunks" title="Chunks and assets">
        <template #description>What the browser loads up front, what it loads on demand, and the files the build emits besides code.</template>
        <div class="panels">
            <section v-for="group in groups" :key="group.id" class="panel" :aria-labelledby="`chunks-${group.id}`">
                <h3 :id="`chunks-${group.id}`" class="panel__title">
                    <span>{{ group.title }}</span>
                    <span class="panel__total">{{ formatBytes(group.bytes) }}</span>
                </h3>
                <ul class="rows">
                    <li v-for="chunk in group.visible" :key="chunk.id" class="row">
                        <span class="row__name">
                            <span class="mono">{{ chunk.id }}</span>
                            <span class="row__tags">
                                <span v-if="chunk.entry" class="tag" :title="chunk.entryModule === undefined ? 'An entry chunk' : `Entry chunk for ${chunk.entryModule}`">entry</span>
                                <span v-if="group.id === 'css'" class="tag">{{ chunk.loading === 'lazy' ? 'lazy' : 'initial' }}</span>
                                <span v-if="chunk.entryModule !== undefined" class="muted row__entry">{{ chunk.entryModule }}</span>
                            </span>
                        </span>
                        <span class="row__figures">
                            <span class="num">{{ formatBytes(chunk.bytes) }}</span>
                            <span v-if="hasBaseline && chunk.delta !== undefined" class="num row__delta" :class="`tone-${deltaTone(chunk.delta)}`">{{ formatDelta(chunk.delta) }}</span>
                        </span>
                    </li>
                </ul>
                <button v-if="group.hidden > 0" type="button" class="link-button" @click="expand(group.id)">Show {{ plural(group.hidden, 'more chunk') }}</button>
            </section>

            <section v-if="assets.length > 0" class="panel" aria-labelledby="chunks-assets">
                <h3 id="chunks-assets" class="panel__title">
                    <span>Assets</span>
                    <span class="panel__total">{{ formatBytes(assetBytes) }}</span>
                </h3>
                <ul class="rows">
                    <li v-for="group in assets" :key="group.kind" class="asset">
                        <button
                            type="button"
                            class="asset__toggle"
                            :aria-expanded="isOpen(group.kind) ? 'true' : 'false'"
                            :aria-controls="isOpen(group.kind) ? `asset-files-${group.kind}` : undefined"
                            @click="toggle(group.kind)"
                        >
                            <CodiconIcon name="chevron-right" class="asset__chevron" :class="{ 'asset__chevron--open': isOpen(group.kind) }" />
                            <span class="asset__kind">{{ ASSET_TEXT[group.kind] }}</span>
                            <span class="muted asset__count">{{ plural(group.files.length, 'file') }}</span>
                            <span class="num asset__bytes">{{ formatBytes(group.bytes) }}</span>
                        </button>
                        <ul v-if="isOpen(group.kind)" :id="`asset-files-${group.kind}`" class="asset__files">
                            <li v-for="file in group.files" :key="file.id" class="row">
                                <span class="mono row__name">{{ file.id }}</span>
                                <span class="num">{{ formatBytes(file.bytes) }}</span>
                            </li>
                        </ul>
                    </li>
                </ul>
            </section>
        </div>
    </DashboardSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { formatBytes } from '../../core/format';
import { deltaTone, formatDelta, plural } from '../format';
import CodiconIcon from './CodiconIcon.vue';
import DashboardSection from './DashboardSection.vue';

import type { AssetGroupDto, AssetKindDto, ChunkRowDto } from '../../shared/dashboard';

type GroupId = 'initial' | 'lazy' | 'css';

const props = defineProps<{
    readonly chunks: readonly ChunkRowDto[];
    readonly assets: readonly AssetGroupDto[];
    readonly hasBaseline: boolean;
}>();

const ROW_LIMIT = 12;

const ASSET_TEXT: Readonly<Record<AssetKindDto, string>> = {
    image: 'Images',
    font: 'Fonts',
    wasm: 'WebAssembly',
    html: 'HTML',
    other: 'Other files',
};

const GROUPS: readonly { readonly id: GroupId; readonly title: string; readonly matches: (chunk: ChunkRowDto) => boolean }[] = [
    { id: 'initial', title: 'JavaScript loaded up front', matches: chunk => chunk.kind === 'js' && chunk.loading === 'initial' },
    { id: 'lazy', title: 'JavaScript loaded lazily', matches: chunk => chunk.kind === 'js' && chunk.loading === 'lazy' },
    { id: 'css', title: 'Stylesheets', matches: chunk => chunk.kind === 'css' },
];

const expanded = ref<ReadonlySet<GroupId>>(new Set());
const open = ref<ReadonlySet<AssetKindDto>>(new Set());

const groups = computed(() => GROUPS.flatMap((spec) => {
    const rows = props.chunks.filter(spec.matches).sort((a, b) => b.bytes - a.bytes);
    if (rows.length === 0) {
        return [];
    }
    const visible = expanded.value.has(spec.id) ? rows : rows.slice(0, ROW_LIMIT);
    return [{
        id: spec.id,
        title: spec.title,
        bytes: rows.reduce((sum, chunk) => sum + chunk.bytes, 0),
        visible,
        hidden: rows.length - visible.length,
    }];
}));

const assetBytes = computed(() => props.assets.reduce((sum, group) => sum + group.bytes, 0));

function expand(id: GroupId): void {
    expanded.value = new Set([...expanded.value, id]);
}

function isOpen(kind: AssetKindDto): boolean {
    return open.value.has(kind);
}

function toggle(kind: AssetKindDto): void {
    const next = new Set(open.value);
    if (next.has(kind)) {
        next.delete(kind);
    } else {
        next.add(kind);
    }
    open.value = next;
}
</script>

<style scoped>
.panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    gap: var(--gap) 24px;
}

.panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.panel__title {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 13px;
    font-weight: 600;
}

.panel__total {
    color: var(--tone-muted);
    font-weight: normal;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.rows {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;
    border-bottom: 1px solid var(--border-subtle);
}

.row__name {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.row__tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-size: 12px;
}

.row__tags:empty {
    display: none;
}

.row__entry {
    overflow-wrap: anywhere;
}

.row__figures {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
}

.row__delta {
    font-size: 12px;
}

.link-button {
    align-self: flex-start;
    margin-top: 4px;
}

.asset {
    border-bottom: 1px solid var(--border-subtle);
}

.asset__toggle {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 5px 0;
    border: 0;
    color: inherit;
    background: none;
    text-align: left;
    cursor: pointer;
}

.asset__toggle:hover {
    background: var(--hover);
}

.asset__chevron {
    align-self: center;
    color: var(--tone-muted);
    transition: transform 0.1s ease;
}

.asset__chevron--open {
    transform: rotate(90deg);
}

.asset__kind {
    font-weight: 600;
}

.asset__count {
    font-size: 12px;
}

.asset__bytes {
    margin-left: auto;
}

.asset__files {
    margin: 0 0 6px;
    padding: 0 0 0 22px;
    list-style: none;
}

.asset__files .row:last-child {
    border-bottom: 0;
}
</style>
