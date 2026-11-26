import { describe, expect, it } from 'vitest';

import { buttonByText, mountDashboard, section, textsOf } from './support/dashboard';
import { dashboardModel, OTHER_KEY, TARGET_KEY } from './support/model';

import type { TargetComparisonDto } from '../../shared/dashboard';

const COMPARISON: TargetComparisonDto = {
    targets: [{ key: TARGET_KEY, id: 'webview' }, { key: OTHER_KEY, id: 'extension-host' }],
    rows: [
        { name: 'chart.js', bytes: [63_700, null] },
        { name: 'zod', bytes: [null, 31_800] },
        { name: 'lodash-es', bytes: [24_600, 3_100] },
    ],
};

describe('the comparison of build targets', () => {
    it('is left out when there is nothing to compare', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        expect(section(wrapper, 'comparison').exists()).toBe(false);
    });

    it('shows the size of every package in every target', async () => {
        const wrapper = await mountDashboard(dashboardModel({ comparison: COMPARISON }));
        const comparison = section(wrapper, 'comparison');

        expect(textsOf(comparison, 'thead th')).toEqual(['Package', 'webview (this target)', 'extension-host']);
        expect(comparison.findAll('tbody tr').map(row => textsOf(row, 'th, td'))).toEqual([
            ['chart.js', '63.7 kB', '–not bundled'],
            ['zod', '–not bundled', '31.8 kB'],
            ['lodash-es', '24.6 kB', '3.1 kB'],
        ]);
    });

    it('highlights the column of the selected target', async () => {
        const wrapper = await mountDashboard(dashboardModel({ comparison: COMPARISON }));

        const firstRow = section(wrapper, 'comparison').find('tbody tr');
        expect(firstRow.findAll('td').map(cell => cell.classes('comparison__selected'))).toEqual([true, false]);
    });

    it('scrolls sideways in a labelled region that the keyboard can reach', async () => {
        const wrapper = await mountDashboard(dashboardModel({ comparison: COMPARISON }));

        const region = section(wrapper, 'comparison').find('.scroll');
        expect(region.attributes()).toMatchObject({ role: 'region', tabindex: '0', 'aria-labelledby': 'comparison-heading' });
    });

    it('shows the first 100 packages and the rest on request', async () => {
        const rows = Array.from({ length: 120 }, (_, index) => ({ name: `package-${index}`, bytes: [1_000 + index, null] }));
        const wrapper = await mountDashboard(dashboardModel({ comparison: { targets: COMPARISON.targets, rows } }));
        const comparison = section(wrapper, 'comparison');

        expect(comparison.findAll('tbody tr')).toHaveLength(100);
        await buttonByText(comparison, 'Show all 120 packages').trigger('click');
        expect(comparison.findAll('tbody tr')).toHaveLength(120);
    });

    it('says when no target bundles a package', async () => {
        const wrapper = await mountDashboard(dashboardModel({ comparison: { targets: COMPARISON.targets, rows: [] } }));

        expect(section(wrapper, 'comparison').find('.empty').text()).toBe('None of the build targets bundles a package from node_modules.');
    });
});
