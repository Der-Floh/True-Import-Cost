<template>
    <DashboardSection id="treemap" title="Bundle map">
        <template #description>Each tile is sized by its bytes in the build. Select a group to see what is inside it.</template>
        <p v-if="!hasContents(root)" class="empty">The build metadata records no module sizes for this target.</p>
        <template v-else>
            <div class="map-bar">
                <nav class="crumbs" aria-label="Bundle map location">
                    <ol class="crumbs__list">
                        <li v-for="(node, index) in trail" :key="node.id" class="crumbs__item">
                            <template v-if="index < trail.length - 1">
                                <button type="button" class="crumbs__link" @click="goTo(index)">{{ node.label }}</button>
                                <CodiconIcon name="chevron-right" class="crumbs__separator" />
                            </template>
                            <span v-else class="crumbs__current" aria-current="location">{{ node.label }}</span>
                        </li>
                    </ol>
                </nav>
                <span class="map-bar__size">{{ formatBytes(scope.bytes) }}</span>
                <div v-if="scopePackage !== undefined" class="map-bar__actions">
                    <button type="button" class="button" @click="emit('explain', scopePackage)">
                        <CodiconIcon name="question" />Explain why included
                    </button>
                    <button type="button" class="button" @click="emit('showImporters', scopePackage)">
                        <CodiconIcon name="references" />Show importers
                    </button>
                </div>
            </div>

            <div ref="canvas" class="map" :style="{ height: `${height}px` }">
                <div
                    v-for="tile in tiles"
                    :key="tile.node.id"
                    class="tile"
                    :class="tile.classes"
                    :style="tile.style"
                >
                    <button
                        type="button"
                        class="tile__button"
                        :data-node="tile.node.id"
                        :aria-label="tile.ariaLabel"
                        :aria-disabled="tile.action === 'none' ? 'true' : undefined"
                        :title="tile.title"
                        @click="activate(tile.node)"
                    >
                        <span v-if="tile.showLabel" class="tile__label">{{ tile.node.label }}</span>
                        <span v-if="tile.showSize" class="tile__size">{{ tile.size }}</span>
                    </button>
                    <div v-if="tile.packageName !== undefined" class="tile__actions">
                        <button
                            type="button"
                            class="icon-button tile__action"
                            :aria-label="`Explain why ${tile.packageName} is included`"
                            :title="`Explain why ${tile.packageName} is included`"
                            @click="emit('explain', tile.packageName)"
                        >
                            <CodiconIcon name="question" />
                        </button>
                        <button
                            type="button"
                            class="icon-button tile__action"
                            :aria-label="`Show importers of ${tile.packageName}`"
                            :title="`Show importers of ${tile.packageName}`"
                            @click="emit('showImporters', tile.packageName)"
                        >
                            <CodiconIcon name="references" />
                        </button>
                    </div>
                </div>
            </div>
            <p class="sr-only" aria-live="polite">{{ announcement }}</p>

            <ul class="legend" aria-label="Legend">
                <li v-for="entry in legend.families" :key="entry.family" class="legend__item">
                    <span class="legend__swatch" :class="`tile--${entry.family}`" />{{ entry.label }}
                </li>
                <li v-if="legend.lazy" class="legend__item">
                    <span class="legend__swatch legend__swatch--lazy" />Hatched: loaded lazily
                </li>
                <li v-if="legend.duplicate" class="legend__item">
                    <span class="legend__swatch legend__swatch--duplicate" />Corner mark: package bundled more than once
                </li>
            </ul>
        </template>
    </DashboardSection>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';

import { formatBytes } from '../../core/format';
import { useElementWidth } from '../composables/useElementWidth';
import { formatShare, plural } from '../format';
import { hasContents, isSmallerGroup, kindText, rebase, tileAction, tileFamily, visibleChildren } from '../treemap/nodes';
import { squarify } from '../treemap/squarify';
import CodiconIcon from './CodiconIcon.vue';
import DashboardSection from './DashboardSection.vue';

import type { TreemapNodeDto } from '../../shared/dashboard';
import type { TileAction, TileFamily } from '../treemap/nodes';
import type { Tile } from '../treemap/squarify';

const props = defineProps<{
    readonly root: TreemapNodeDto;
}>();

const emit = defineEmits<{
    openModule: [moduleId: string];
    explain: [packageName: string];
    showImporters: [packageName: string];
}>();

const MIN_HEIGHT = 280;
const MAX_HEIGHT = 460;
const MIN_TILE_AREA = 900;
const MAX_TILES = 60;

const HINTS: Readonly<Record<TileAction, string>> = {
    drill: 'Select to see what is inside.',
    open: 'Select to open the file.',
    explain: 'Select to explain why it is included.',
    none: '',
};

const LEGEND: readonly { readonly family: TileFamily; readonly label: string }[] = [
    { family: 'project', label: 'Your code' },
    { family: 'package', label: 'Packages' },
    { family: 'generated', label: 'Generated by the bundler' },
    { family: 'other', label: 'Other' },
];

const canvas = ref<HTMLElement | null>(null);
const width = useElementWidth(canvas, 800);
const height = computed(() => Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, 240 + width.value * 0.18))));

const path = shallowRef<TreemapNodeDto[]>([]);
const announcement = ref('');

const trail = computed(() => [props.root, ...path.value]);
const scope = computed(() => path.value.at(-1) ?? props.root);
const scopePackage = computed(() => (scope.value.kind === 'package' ? scope.value.packageName : undefined));

const children = computed(() => visibleChildren(scope.value, {
    minimumShare: MIN_TILE_AREA / (width.value * height.value),
    maxTiles: MAX_TILES,
}));

const tiles = computed(() => {
    const total = children.value.reduce((sum, node) => sum + node.bytes, 0);
    return squarify(children.value, node => node.bytes, { x: 0, y: 0, width: width.value, height: height.value })
        .map(tile => describe(tile, total));
});

const legend = computed(() => {
    const families = new Set(tiles.value.map(tile => tile.family));
    return {
        families: LEGEND.filter(entry => families.has(entry.family)),
        lazy: tiles.value.some(tile => tile.node.lazy),
        duplicate: tiles.value.some(tile => tile.node.duplicate === true),
    };
});

watch(() => props.root, (root) => {
    path.value = rebase(root, path.value);
});

function describe(tile: Tile<TreemapNodeDto>, total: number) {
    const node = tile.item;
    const action = tileAction(node);
    const family = tileFamily(node, trail.value);
    const size = formatBytes(node.bytes);
    const facts = [
        `${size}, ${formatShare(node.bytes, total)} of ${scope.value.label}`,
        ...(node.kind === 'other' ? [] : [kindText(node.kind)]),
        ...(node.lazy ? ['loaded lazily'] : []),
        ...(node.duplicate === true ? ['bundled more than once'] : []),
    ];
    const showLabel = tile.width >= 44 && tile.height >= 20;
    const roomy = tile.width >= 120 && tile.height >= 64;
    return {
        node,
        action,
        family,
        size,
        showLabel,
        showSize: showLabel && tile.height >= 38,
        packageName: roomy && node.kind === 'package' && !isSmallerGroup(node) ? node.packageName : undefined,
        title: [node.label, ...facts, HINTS[action]].filter(line => line !== '').join('\n'),
        ariaLabel: `${node.label}: ${facts.join(', ')}. ${HINTS[action]}`.trim(),
        classes: [`tile--${family}`, { 'tile--lazy': node.lazy, 'tile--duplicate': node.duplicate === true, 'tile--inert': action === 'none' }],
        style: { left: `${tile.x}px`, top: `${tile.y}px`, width: `${tile.width}px`, height: `${tile.height}px` },
    };
}

async function focusTile(id: string | undefined): Promise<void> {
    await nextTick();
    const buttons = [...(canvas.value?.querySelectorAll<HTMLButtonElement>('.tile__button') ?? [])];
    (buttons.find(button => button.dataset.node === id) ?? buttons[0])?.focus();
}

function announce(): void {
    announcement.value = `${scope.value.label}: ${formatBytes(scope.value.bytes)} in ${plural(children.value.length, 'tile')}`;
}

function activate(node: TreemapNodeDto): void {
    const action = tileAction(node);
    if (action === 'drill') {
        path.value = [...path.value, node];
        announce();
        void focusTile(undefined);
    } else if (action === 'open' && node.moduleId !== undefined) {
        emit('openModule', node.moduleId);
    } else if (action === 'explain' && node.packageName !== undefined) {
        emit('explain', node.packageName);
    }
}

function goTo(index: number): void {
    const left = path.value[index];
    path.value = path.value.slice(0, index);
    announce();
    void focusTile(left?.id);
}
</script>

<style scoped>
.map-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    min-height: 26px;
}

.crumbs {
    min-width: 0;
}

.crumbs__list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.crumbs__item {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
}

.crumbs__link {
    padding: 1px 4px;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--vscode-textLink-foreground);
    background: none;
    overflow-wrap: anywhere;
    cursor: pointer;
}

.crumbs__link:hover {
    color: var(--vscode-textLink-activeForeground);
    background: var(--vscode-toolbar-hoverBackground);
}

.crumbs__current {
    padding: 1px 4px;
    font-weight: 600;
    overflow-wrap: anywhere;
}

.crumbs__separator {
    color: var(--tone-muted);
}

.map-bar__size {
    color: var(--tone-muted);
}

.map-bar__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-left: auto;
}

.map {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-md);
}

.tile {
    position: absolute;
    padding: 1px;
}

.tile--other {
    --tile-color: var(--kind-other);
}

.tile--project {
    --tile-color: var(--kind-project);
}

.tile--package {
    --tile-color: var(--kind-package);
}

.tile--generated {
    --tile-color: var(--kind-generated);
}

.tile__button {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    width: 100%;
    height: 100%;
    padding: 3px 6px;
    overflow: hidden;
    border: 0;
    border-radius: 3px;
    color: var(--vscode-foreground);
    background-color: color-mix(in srgb, var(--tile-color) 36%, var(--surface));
    font-size: 12px;
    line-height: 16px;
    text-align: left;
    cursor: pointer;
}

.tile__button:hover {
    background-color: color-mix(in srgb, var(--tile-color) 52%, var(--surface));
}

.tile__button:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: -2px;
}

.tile--lazy .tile__button {
    background-color: color-mix(in srgb, var(--tile-color) 16%, var(--surface));
    background-image: repeating-linear-gradient(
        135deg,
        color-mix(in srgb, var(--tile-color) 38%, transparent) 0 2px,
        transparent 2px 9px
    );
}

.tile--lazy .tile__button:hover {
    background-color: color-mix(in srgb, var(--tile-color) 30%, var(--surface));
}

.tile--lazy .tile__label,
.tile--lazy .tile__size {
    text-shadow: 0 0 2px var(--surface), 0 0 4px var(--surface);
}

.tile--duplicate .tile__button::after {
    position: absolute;
    top: 0;
    right: 0;
    border-style: solid;
    border-width: 0 12px 12px 0;
    border-color: transparent var(--tone-warn) transparent transparent;
    content: '';
}

.tile--inert .tile__button {
    cursor: default;
}

.tile__label,
.tile__size {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tile__label {
    font-weight: 600;
}

.tile__size {
    opacity: 0.85;
    font-size: 11px;
}

.tile__actions {
    position: absolute;
    right: 5px;
    bottom: 5px;
    display: flex;
    gap: 2px;
    opacity: 0;
}

.tile:hover .tile__actions,
.tile:focus-within .tile__actions {
    opacity: 1;
}

.tile__action {
    width: 22px;
    height: 22px;
    background: color-mix(in srgb, var(--surface) 80%, transparent);
}

.tile__action:hover {
    background: var(--surface);
}

.legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin: 0;
    padding: 0;
    color: var(--tone-muted);
    font-size: 12px;
    list-style: none;
}

.legend__item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.legend__swatch {
    position: relative;
    flex: none;
    width: 14px;
    height: 14px;
    overflow: hidden;
    border: 1px solid var(--tile-color);
    border-radius: 3px;
    background-color: color-mix(in srgb, var(--tile-color) 36%, var(--surface));
}

.legend__swatch--lazy,
.legend__swatch--duplicate {
    border: 1px solid var(--tone-muted);
    background-color: transparent;
}

.legend__swatch--lazy {
    background-image: repeating-linear-gradient(
        135deg,
        color-mix(in srgb, var(--tone-muted) 70%, transparent) 0 2px,
        transparent 2px 5px
    );
}

.legend__swatch--duplicate::after {
    position: absolute;
    top: 0;
    right: 0;
    border-style: solid;
    border-width: 0 8px 8px 0;
    border-color: transparent var(--tone-warn) transparent transparent;
    content: '';
}

@media (forced-colors: active) {
    .tile__button {
        border: 1px solid ButtonText;
    }
}
</style>
