import { describe, expect, it } from 'vitest';

import { buttonByText, mountDashboard, section, textsOf } from './support/dashboard';
import { assetGroup, budgetState, chunkRow, dashboardModel, moduleChange, withBaseline } from './support/model';

import type { ChunkRowDto } from '../../shared/dashboard';

const CHUNKS: readonly ChunkRowDto[] = [
    chunkRow('assets/vendor.js', { bytes: 21_200, delta: 0 }),
    chunkRow('assets/index.js', { bytes: 248_300, entry: true, entryModule: 'index.html', delta: 4_100 }),
    chunkRow('assets/Dashboard.js', { bytes: 63_700, loading: 'lazy', delta: -1_100 }),
    chunkRow('assets/index.css', { kind: 'css', bytes: 20_400 }),
    chunkRow('assets/Dashboard.css', { kind: 'css', bytes: 8_000, loading: 'lazy' }),
];

describe('chunks and assets', () => {
    it('are left out when the build has neither', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        expect(section(wrapper, 'chunks').exists()).toBe(false);
    });

    it('group the chunks into JavaScript loaded up front, loaded lazily, and stylesheets', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { chunks: CHUNKS } }));
        const chunks = section(wrapper, 'chunks');

        expect(textsOf(chunks, '.panel__title')).toEqual([
            'JavaScript loaded up front270 kB',
            'JavaScript loaded lazily63.7 kB',
            'Stylesheets28.4 kB',
        ]);
        expect(textsOf(chunks, '.row__name .mono')).toEqual([
            'assets/index.js',
            'assets/vendor.js',
            'assets/Dashboard.js',
            'assets/index.css',
            'assets/Dashboard.css',
        ]);
        expect(textsOf(chunks, '.row__tags')).toEqual(['entryindex.html', '', '', 'initial', 'lazy']);
    });

    it('show what changed since the baseline only when there is one', async () => {
        const plain = await mountDashboard(dashboardModel({ selected: { chunks: CHUNKS } }));
        expect(section(plain, 'chunks').findAll('.row__delta')).toHaveLength(0);
        plain.unmount();

        const compared = await mountDashboard(dashboardModel({ selected: withBaseline({ chunks: CHUNKS }) }));
        expect(textsOf(section(compared, 'chunks'), '.row__delta')).toEqual(['+4.1 kB', 'no change', '\u22121.1 kB']);
    });

    it('show the first chunks of a long group and the rest on request', async () => {
        const lazy = Array.from({ length: 15 }, (_, index) => chunkRow(`assets/page-${index}.js`, { loading: 'lazy', bytes: 1_000 + index }));
        const wrapper = await mountDashboard(dashboardModel({ selected: { chunks: lazy } }));
        const chunks = section(wrapper, 'chunks');

        expect(chunks.findAll('.row')).toHaveLength(12);
        await buttonByText(chunks, 'Show 3 more chunks').trigger('click');
        expect(chunks.findAll('.row')).toHaveLength(15);
    });

    it('list the assets by kind, with their files on request', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            selected: {
                assets: [
                    assetGroup('image', [['assets/hero.webp', 86_300], ['assets/logo.svg', 4_200]]),
                    assetGroup('font', [['assets/inter.woff2', 12_900]]),
                    assetGroup('wasm', [['assets/codec.wasm', 140_000]]),
                ],
            },
        }));
        const assets = section(wrapper, 'chunks');

        expect(textsOf(assets, '.panel__title')).toEqual(['Assets243 kB']);
        const toggles = assets.findAll('.asset__toggle');
        expect(toggles.map(toggle => toggle.text())).toEqual(['Images2 files90.5 kB', 'Fonts1 file12.9 kB', 'WebAssembly1 file140 kB']);
        expect(toggles[0]!.attributes('aria-expanded')).toBe('false');
        expect(toggles[0]!.attributes('aria-controls')).toBeUndefined();
        expect(assets.find('.asset__files').exists()).toBe(false);

        await toggles[0]!.trigger('click');
        expect(toggles[0]!.attributes('aria-expanded')).toBe('true');
        expect(assets.find(`#${toggles[0]!.attributes('aria-controls')}`).classes()).toContain('asset__files');
        expect(textsOf(assets, '.asset__files .row')).toEqual(['assets/hero.webp86.3 kB', 'assets/logo.svg4.2 kB']);

        await toggles[0]!.trigger('click');
        expect(assets.find('.asset__files').exists()).toBe(false);
    });
});

describe('duplicated packages', () => {
    it('list every copy with its version, install location and size', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            selected: {
                duplicates: [{
                    name: 'date-fns',
                    bytes: 21_900,
                    instances: [
                        { version: '2.30.0', root: 'node_modules/date-fns', bytes: 12_100 },
                        { root: 'node_modules/@vuepic/vue-datepicker/node_modules/date-fns', bytes: 9_800 },
                    ],
                }],
            },
        }));
        const duplicates = section(wrapper, 'duplicates');

        expect(duplicates.find('.duplicate__head').text()).toBe('date-fns2 copies, 21.9 kB in all');
        expect(duplicates.findAll('tbody tr').map(tableRow => textsOf(tableRow, 'td'))).toEqual([
            ['2.30.0', 'node_modules/date-fns', '12.1 kB'],
            ['unknown', 'node_modules/@vuepic/vue-datepicker/node_modules/date-fns', '9.8 kB'],
        ]);
    });

    it('are left out when no package is duplicated', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        expect(section(wrapper, 'duplicates').exists()).toBe(false);
    });
});

describe('budgets', () => {
    it('show each budget against its limit, in words', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            selected: {
                budgets: [
                    budgetState('total', 500_000, 486_300, 'Total output'),
                    budgetState('initial', 280_000, 289_900, 'Initial load'),
                    budgetState('package', 30_000, 24_600, 'lodash-es'),
                ],
            },
        }));
        const budgets = section(wrapper, 'budgets');

        expect(textsOf(budgets, '.budget__label')).toEqual(['Total output', 'Initial load', 'lodash-es package']);
        expect(textsOf(budgets, '.budget__figure')).toEqual(['486 kB of 500 kB', '290 kB of 280 kB', '24.6 kB of 30 kB']);
        expect(textsOf(budgets, '.budget__status')).toEqual([
            'Within budget, 13.7 kB to spare',
            'Exceeded by 9.9 kB',
            'Within budget, 5.4 kB to spare',
        ]);
        expect(budgets.findAll('.budget__status').map(status => status.classes('tone-bad'))).toEqual([false, true, false]);
    });

    it('draw a bar for each budget, with the limit marked when it is exceeded', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            selected: { budgets: [budgetState('total', 500_000, 400_000), budgetState('initial', 200_000, 250_000)] },
        }));
        const meters = section(wrapper, 'budgets').findAll('.meter');

        expect(meters.map(meter => meter.attributes('aria-hidden'))).toEqual(['true', 'true']);
        const percent = (element: Element, property: 'width' | 'left'): number => Number.parseFloat((element as HTMLElement).style[property]);
        expect(percent(meters[0]!.find('.meter__fill').element, 'width')).toBe(80);
        expect(meters[0]!.find('.meter__limit').exists()).toBe(false);
        expect(percent(meters[1]!.find('.meter__fill').element, 'width')).toBe(100);
        expect(percent(meters[1]!.find('.meter__limit').element, 'left')).toBe(80);
    });

    it('are left out when none is configured', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        expect(section(wrapper, 'budgets').exists()).toBe(false);
    });
});

describe('changes since the baseline', () => {
    it('are shown only with a baseline', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { moduleChanges: [moduleChange('src/a.ts', 10, 20)] } }));

        expect(section(wrapper, 'changes').exists()).toBe(false);
    });

    it('list the largest changes first, with the sizes before and after', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            selected: withBaseline({
                moduleChanges: [
                    moduleChange('src/components/DashboardView.vue', 15_100, 18_400),
                    moduleChange('moment/moment.js', 18_300, 0),
                    moduleChange('chart.js/dist/chart.js', 0, 52_300),
                ],
            }),
        }));
        const changes = section(wrapper, 'changes');

        expect(changes.findAll('tbody tr').map(tableRow => tableRow.text())).toEqual([
            'chart.js/dist/chart.jsNew0 B → 52.3 kB+52.3 kB',
            'moment/moment.jsRemoved18.3 kB → 0 B\u221218.3 kB',
            'src/components/DashboardView.vue15.1 kB → 18.4 kB+3.3 kB',
        ]);
        expect(changes.findAll('tbody td').map(cell => cell.classes().find(name => name.startsWith('tone-')))).toEqual(['tone-bad', 'tone-good', 'tone-bad']);
    });

    it('say when nothing changed', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: withBaseline() }));

        expect(section(wrapper, 'changes').find('.empty').text()).toBe('No module changed size since the baseline.');
    });
});
