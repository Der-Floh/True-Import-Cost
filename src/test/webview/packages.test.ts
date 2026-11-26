import { describe, expect, it } from 'vitest';

import { buttonByText, mountDashboard, section, textsOf } from './support/dashboard';
import { budgetState, dashboardModel, packageRow, withBaseline } from './support/model';

import type { Dashboard } from './support/dashboard';
import type { PackageRowDto } from '../../shared/dashboard';

const PACKAGES: readonly PackageRowDto[] = [
    packageRow('vue', { versions: ['3.5.46'], bytes: 60_000 }),
    packageRow('lodash-es', { versions: ['4.17.21'], bytes: 3_000, lazyBytes: 1_000, modules: 6 }),
    packageRow('chart.js', { versions: ['4.4.7'], bytes: 40_000, lazyBytes: 40_000, modules: 2 }),
    packageRow('date-fns', { versions: ['2.30.0', '3.6.0'], bytes: 21_900, modules: 4, duplicate: true }),
];

const CHANGED: readonly PackageRowDto[] = [
    packageRow('vue', { bytes: 60_000, change: { status: 'unchanged', before: 60_000, delta: 0, versionsBefore: ['1.0.0'] } }),
    packageRow('chart.js', { bytes: 40_000, change: { status: 'added', before: 0, delta: 40_000, versionsBefore: [] } }),
    packageRow('lodash-es', { bytes: 3_000, change: { status: 'changed', before: 900, delta: 2_100, versionsBefore: ['1.0.0'] } }),
    packageRow('axios', { versions: ['1.7.9'], bytes: 13_200, change: { status: 'changed', before: 17_200, delta: -4_000, versionsBefore: ['1.6.8'] } }),
    packageRow('moment', { versions: [], bytes: 0, modules: 0, change: { status: 'removed', before: 18_300, delta: -18_300, versionsBefore: ['2.30.1'] } }),
];

function packagesOf(wrapper: Dashboard) {
    return section(wrapper, 'packages');
}

function names(wrapper: Dashboard): string[] {
    return textsOf(packagesOf(wrapper), 'tbody .packages__name');
}

function row(wrapper: Dashboard, name: string) {
    const found = packagesOf(wrapper).findAll('tbody tr').find(candidate => candidate.find('.packages__name').text() === name);
    if (found === undefined) {
        throw new Error(`No row for ${name}`);
    }
    return found;
}

describe('the package list', () => {
    it('lists the packages largest first, with versions, module counts and their lazy part', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { packages: PACKAGES } }));

        expect(names(wrapper)).toEqual(['vue', 'chart.js', 'date-fns', 'lodash-es']);
        expect(textsOf(row(wrapper, 'date-fns'), '.packages__detail')).toEqual(['2.30.0, 3.6.0', '4 modules']);
        expect(row(wrapper, 'chart.js').find('td.num').text()).toBe('40 kBall lazy');
        expect(row(wrapper, 'lodash-es').find('.packages__sub').text()).toBe('1 kB lazy');
        expect(row(wrapper, 'vue').find('.packages__sub').exists()).toBe(false);
    });

    it('marks duplicated packages in words', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { packages: PACKAGES } }));

        expect(row(wrapper, 'date-fns').find('.tag--warn').text()).toBe('Duplicate');
        expect(row(wrapper, 'vue').find('.tag--warn').exists()).toBe(false);
    });

    it('sorts by name, then the other way round, and says how it is sorted', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { packages: PACKAGES } }));
        const header = () => packagesOf(wrapper).findAll('thead th');

        expect(header().map(cell => cell.attributes('aria-sort'))).toEqual(['none', 'descending', undefined]);
        await buttonByText(packagesOf(wrapper), 'Package').trigger('click');

        expect(names(wrapper)).toEqual(['chart.js', 'date-fns', 'lodash-es', 'vue']);
        expect(header()[0]!.attributes('aria-sort')).toBe('ascending');
        expect(packagesOf(wrapper).find('caption').text()).toBe('Packages, sorted by name, ascending');

        await buttonByText(packagesOf(wrapper), 'Package').trigger('click');
        expect(names(wrapper)).toEqual(['vue', 'lodash-es', 'date-fns', 'chart.js']);
        expect(header()[0]!.attributes('aria-sort')).toBe('descending');
    });

    it('turns the size order around', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { packages: PACKAGES } }));

        await buttonByText(packagesOf(wrapper), 'Size').trigger('click');

        expect(names(wrapper)).toEqual(['lodash-es', 'date-fns', 'chart.js', 'vue']);
    });

    it('sorts by the change since the baseline, largest growth first', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: withBaseline({ packages: CHANGED }) }));

        await buttonByText(packagesOf(wrapper), 'Change').trigger('click');
        expect(names(wrapper)).toEqual(['chart.js', 'lodash-es', 'vue', 'axios', 'moment']);

        await buttonByText(packagesOf(wrapper), 'Change').trigger('click');
        expect(names(wrapper)).toEqual(['moment', 'axios', 'vue', 'lodash-es', 'chart.js']);
    });

    it('filters by name or version, and says how many match', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { packages: PACKAGES } }));
        const search = packagesOf(wrapper).find('input[type="search"]');
        const count = () => packagesOf(wrapper).find('.tools__count').text();

        expect(count()).toBe('4 packages');
        await search.setValue('LOD');
        expect(names(wrapper)).toEqual(['lodash-es']);
        expect(count()).toBe('1 of 4 packages');

        await search.setValue('3.6');
        expect(names(wrapper)).toEqual(['date-fns']);

        await search.setValue('left-pad');
        expect(names(wrapper)).toEqual([]);
        expect(packagesOf(wrapper).find('tbody').text()).toBe('No package matches “left-pad”.');
    });

    it('labels the filter box', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { packages: PACKAGES } }));

        expect(packagesOf(wrapper).find('label.search').text()).toBe('Filter packages');
    });

    it('describes each change since the baseline in words', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: withBaseline({ packages: CHANGED }) }));
        const change = (name: string) => row(wrapper, name).findAll('td.num')[1]!;

        expect(change('chart.js').text()).toBe('New+40 kB');
        expect(change('lodash-es').text()).toBe('+2.1 kB');
        expect(change('lodash-es').find('.tone-bad').exists()).toBe(true);
        expect(change('axios').text()).toBe('\u22124 kBwas 1.6.8');
        expect(change('axios').find('.tone-good').exists()).toBe(true);
        expect(change('vue').text()).toBe('no change');
        expect(change('moment').text()).toBe('Removed\u221218.3 kB');
    });

    it('shows a removed package only when there is a baseline, without actions', async () => {
        const compared = await mountDashboard(dashboardModel({ selected: withBaseline({ packages: CHANGED }) }));
        const moment = row(compared, 'moment');
        expect(moment.classes()).toContain('packages__row--removed');
        expect(moment.findAll('td.num')[0]!.text()).toBe('—');
        expect(moment.findAll('button')).toHaveLength(0);
        compared.unmount();

        const alone = await mountDashboard(dashboardModel({ selected: { packages: CHANGED } }));
        expect(names(alone)).not.toContain('moment');
        expect(textsOf(packagesOf(alone), 'thead th')).toEqual(['Package', 'Size', 'Actions']);
    });

    it('states a package budget in words', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            selected: {
                packages: [
                    packageRow('lodash-es', { bytes: 24_600, budget: budgetState('package', 30_000, 24_600, 'lodash-es') }),
                    packageRow('chart.js', { bytes: 63_700, budget: budgetState('package', 60_000, 63_700, 'chart.js') }),
                ],
            },
        }));

        const within = row(wrapper, 'lodash-es').find('.tag--good');
        expect(within.text()).toBe('Within budget');
        expect(within.attributes('title')).toBe('24.6 kB, 5.4 kB under the budget of 30 kB');
        const over = row(wrapper, 'chart.js').find('.tag--bad');
        expect(over.text()).toBe('Over budget');
        expect(over.attributes('title')).toBe('63.7 kB, 3.7 kB over the budget of 60 kB');
        expect(over.find('svg').exists()).toBe(true);
    });

    it('renders the first 200 packages and the rest on request', async () => {
        const many = Array.from({ length: 250 }, (_, index) => packageRow(`package-${String(index).padStart(3, '0')}`, { bytes: 100_000 - index }));
        const wrapper = await mountDashboard(dashboardModel({ selected: { packages: many } }));

        expect(names(wrapper)).toHaveLength(200);
        await buttonByText(packagesOf(wrapper), 'Show all 250 packages').trigger('click');

        expect(names(wrapper)).toHaveLength(250);
        expect(names(wrapper).at(-1)).toBe('package-249');
    });

    it('says when the build has no packages', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { packages: [] } }));

        expect(packagesOf(wrapper).find('.empty').text()).toBe('This build bundles no packages from node_modules.');
        expect(packagesOf(wrapper).find('table').exists()).toBe(false);
    });
});
