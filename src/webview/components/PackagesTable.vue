<template>
    <DashboardSection id="packages" title="Packages">
        <template #description>Packages from node_modules in this build, with the bytes they add.</template>
        <p v-if="available.length === 0" class="empty">This build bundles no packages from node_modules.</p>
        <template v-else>
            <div class="tools">
                <label class="search">
                    <CodiconIcon name="search" class="search__icon" />
                    <span class="sr-only">Filter packages</span>
                    <input v-model="query" type="search" class="input search__input" placeholder="Filter packages" spellcheck="false">
                </label>
                <span class="tools__count muted" aria-live="polite">{{ countText }}</span>
            </div>
            <div class="table-wrap">
                <table class="data-table packages">
                    <caption class="sr-only">Packages, sorted by {{ SORT_TEXT[sort.key] }}, {{ sort.direction === 'asc' ? 'ascending' : 'descending' }}</caption>
                    <thead>
                        <tr>
                            <th scope="col" :aria-sort="ariaSort('name')">
                                <button type="button" class="sort" @click="sortBy('name')">
                                    Package<CodiconIcon v-if="sort.key === 'name'" :name="arrow" class="sort__icon" />
                                </button>
                            </th>
                            <th scope="col" class="num" :aria-sort="ariaSort('size')">
                                <button type="button" class="sort" @click="sortBy('size')">
                                    Size<CodiconIcon v-if="sort.key === 'size'" :name="arrow" class="sort__icon" />
                                </button>
                            </th>
                            <th v-if="hasBaseline" scope="col" class="num" :aria-sort="ariaSort('change')">
                                <button type="button" class="sort" @click="sortBy('change')">
                                    Change<CodiconIcon v-if="sort.key === 'change'" :name="arrow" class="sort__icon" />
                                </button>
                            </th>
                            <th scope="col" class="packages__actions-head"><span class="sr-only">Actions</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in visible" :key="row.name" :class="{ 'packages__row--removed': row.change?.status === 'removed' }">
                            <th scope="row" class="packages__package">
                                <span class="packages__line">
                                    <span class="packages__name">{{ row.name }}</span>
                                    <span v-if="row.versions.length > 0" class="packages__detail muted">{{ row.versions.join(', ') }}</span>
                                    <span v-if="row.modules > 0" class="packages__detail muted">{{ plural(row.modules, 'module') }}</span>
                                    <span v-if="row.duplicate" class="tag tag--warn" title="More than one copy of this package is bundled">Duplicate</span>
                                    <span
                                        v-if="row.budget !== undefined"
                                        class="tag"
                                        :class="row.budget.exceeded ? 'tag--bad' : 'tag--good'"
                                        :title="describeBudget(row.budget)"
                                    >
                                        <CodiconIcon v-if="row.budget.exceeded" name="warning" class="tag__icon" />
                                        {{ row.budget.exceeded ? 'Over budget' : 'Within budget' }}
                                    </span>
                                </span>
                            </th>
                            <td class="num">
                                <span>{{ row.change?.status === 'removed' ? '—' : formatBytes(row.bytes) }}</span>
                                <span v-if="row.lazyBytes > 0" class="packages__sub muted">{{ row.lazyBytes >= row.bytes ? 'all lazy' : `${formatBytes(row.lazyBytes)} lazy` }}</span>
                            </td>
                            <td v-if="hasBaseline" class="num">
                                <template v-if="row.change !== undefined">
                                    <span class="packages__change">
                                        <span v-if="row.change.status === 'added' || row.change.status === 'removed'" class="tag">{{ STATUS_TEXT[row.change.status] }}</span>
                                        <span :class="`tone-${deltaTone(row.change.delta)}`">{{ formatDelta(row.change.delta) }}</span>
                                    </span>
                                    <span v-if="versionsChanged(row)" class="packages__sub muted">was {{ row.change.versionsBefore.join(', ') }}</span>
                                </template>
                                <span v-else class="muted" title="Not compared with the baseline">–</span>
                            </td>
                            <td class="packages__actions">
                                <template v-if="row.change?.status !== 'removed'">
                                    <button
                                        type="button"
                                        class="icon-button"
                                        :aria-label="`Explain why ${row.name} is included`"
                                        :title="`Explain why ${row.name} is included`"
                                        @click="emit('explain', row.name)"
                                    >
                                        <CodiconIcon name="question" />
                                    </button>
                                    <button
                                        type="button"
                                        class="icon-button"
                                        :aria-label="`Show importers of ${row.name}`"
                                        :title="`Show importers of ${row.name}`"
                                        @click="emit('showImporters', row.name)"
                                    >
                                        <CodiconIcon name="references" />
                                    </button>
                                </template>
                            </td>
                        </tr>
                        <tr v-if="rows.length === 0">
                            <td :colspan="hasBaseline ? 4 : 3" class="muted">No package matches “{{ query.trim() }}”.</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <button v-if="hidden > 0" type="button" class="button show-all" @click="showAll">Show all {{ rows.length }} packages</button>
        </template>
    </DashboardSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { formatBytes } from '../../core/format';
import { useRowLimit } from '../composables/useRowLimit';
import { deltaTone, describeBudget, formatDelta, plural } from '../format';
import CodiconIcon from './CodiconIcon.vue';
import DashboardSection from './DashboardSection.vue';

import type { PackageRowDto } from '../../shared/dashboard';

type SortKey = 'name' | 'size' | 'change';
type SortDirection = 'asc' | 'desc';

const props = defineProps<{
    readonly packages: readonly PackageRowDto[];
    readonly hasBaseline: boolean;
}>();

const emit = defineEmits<{
    explain: [packageName: string];
    showImporters: [packageName: string];
}>();

const ROW_LIMIT = 200;

const SORT_TEXT: Readonly<Record<SortKey, string>> = { name: 'name', size: 'size', change: 'change since the baseline' };
const DEFAULT_DIRECTION: Readonly<Record<SortKey, SortDirection>> = { name: 'asc', size: 'desc', change: 'desc' };
const STATUS_TEXT = { added: 'New', removed: 'Removed' } as const;

const query = ref('');
const sort = ref<{ key: SortKey; direction: SortDirection }>({ key: 'size', direction: 'desc' });

const available = computed(() => props.packages.filter(row => props.hasBaseline || row.change?.status !== 'removed'));

const rows = computed(() => {
    const needle = query.value.trim().toLowerCase();
    const matching = needle === ''
        ? available.value
        : available.value.filter(row => row.name.toLowerCase().includes(needle) || row.versions.some(version => version.includes(needle)));
    const factor = sort.value.direction === 'asc' ? 1 : -1;
    return [...matching].sort((a, b) => factor * compare(a, b, sort.value.key) || a.name.localeCompare(b.name));
});

const { visible, hidden, showAll } = useRowLimit(rows, ROW_LIMIT);

const arrow = computed(() => (sort.value.direction === 'asc' ? 'arrow-up' : 'arrow-down'));

const countText = computed(() => (rows.value.length === available.value.length
    ? plural(available.value.length, 'package')
    : `${rows.value.length} of ${plural(available.value.length, 'package')}`));

function sizeOf(row: PackageRowDto): number {
    return row.change?.status === 'removed' ? 0 : row.bytes;
}

function compare(a: PackageRowDto, b: PackageRowDto, key: SortKey): number {
    if (key === 'name') {
        return a.name.localeCompare(b.name);
    }
    if (key === 'change') {
        return (a.change?.delta ?? 0) - (b.change?.delta ?? 0);
    }
    return sizeOf(a) - sizeOf(b);
}

function sortBy(key: SortKey): void {
    sort.value = sort.value.key === key
        ? { key, direction: sort.value.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: DEFAULT_DIRECTION[key] };
}

function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sort.value.key !== key) {
        return 'none';
    }
    return sort.value.direction === 'asc' ? 'ascending' : 'descending';
}

function versionsChanged(row: PackageRowDto): boolean {
    const before = row.change?.versionsBefore ?? [];
    return row.change?.status === 'changed' && before.length > 0 && before.join() !== row.versions.join();
}
</script>

<style scoped>
.tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
}

.search {
    position: relative;
    display: flex;
    flex: 1 1 220px;
    max-width: 360px;
}

.search__icon {
    position: absolute;
    top: 50%;
    left: 7px;
    color: var(--tone-muted);
    transform: translateY(-50%);
    pointer-events: none;
}

.search__input {
    width: 100%;
    padding-left: 28px;
}

.tools__count {
    font-size: 12px;
}

.table-wrap {
    min-width: 0;
}

.packages {
    table-layout: auto;
}

.packages th[scope='row'] {
    font-weight: normal;
}

.sort {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0;
    border: 0;
    color: inherit;
    background: none;
    font-weight: 600;
    cursor: pointer;
}

.sort:hover {
    color: var(--vscode-foreground);
}

.sort__icon {
    width: 14px;
    height: 14px;
}

.packages__package {
    width: 100%;
    min-width: 0;
}

.packages__line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
}

.packages__name {
    font-weight: 600;
    overflow-wrap: anywhere;
}

.packages__detail {
    font-size: 12px;
}

.packages__sub {
    display: block;
    font-size: 12px;
}

.packages__change {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: flex-end;
    gap: 2px 4px;
}

@media (min-width: 600px) {
    .packages__change {
        flex-wrap: nowrap;
    }
}

.packages__row--removed .packages__name {
    color: var(--tone-muted);
    text-decoration: line-through;
}

.packages__actions-head,
.packages__actions {
    width: 1%;
    white-space: nowrap;
}

.packages__actions {
    padding-top: 2px;
    padding-bottom: 2px;
}

.tag__icon {
    width: 12px;
    height: 12px;
}

.show-all {
    align-self: flex-start;
}
</style>
