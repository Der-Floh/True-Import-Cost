import { describe, expect, it } from 'vitest';

import { buttonByText, mountDashboard, section, takeMessages } from './support/dashboard';
import {
    dashboardModel,
    DAY,
    historyPoint,
    modelWithoutTarget,
    OTHER_KEY,
    otherTargetSummary,
    TARGET_KEY,
    targetSummary,
    withBaseline,
} from './support/model';

describe('every action posts exactly one message the host accepts', () => {
    it('refreshes', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        await buttonByText(wrapper.find('header'), 'Refresh').trigger('click');

        expect(takeMessages()).toEqual([{ type: 'refresh' }]);
    });

    it('refreshes from the empty state', async () => {
        const wrapper = await mountDashboard(modelWithoutTarget());

        await buttonByText(wrapper, 'Refresh').trigger('click');

        expect(takeMessages()).toEqual([{ type: 'refresh' }]);
    });

    it('selects another target by its key', async () => {
        const wrapper = await mountDashboard(dashboardModel({ targets: selected => [targetSummary(selected), otherTargetSummary()] }));

        await wrapper.find('select').setValue(OTHER_KEY);

        expect(takeMessages()).toEqual([{ type: 'selectTarget', target: OTHER_KEY }]);
    });

    it('does not select the target that is already selected', async () => {
        const wrapper = await mountDashboard(dashboardModel({ targets: selected => [targetSummary(selected), otherTargetSummary()] }));

        await wrapper.find('select').setValue(TARGET_KEY);

        expect(takeMessages()).toEqual([]);
    });

    it('pins the build as the baseline', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        await buttonByText(wrapper, 'Pin as baseline').trigger('click');

        expect(takeMessages()).toEqual([{ type: 'pinBaseline', target: TARGET_KEY }]);
    });

    it('compares with a file', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        await buttonByText(wrapper, 'Compare with file…').trigger('click');

        expect(takeMessages()).toEqual([{ type: 'compareWithFile', target: TARGET_KEY }]);
    });

    it('clears the baseline', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: withBaseline() }));

        await buttonByText(wrapper, 'Clear baseline').trigger('click');

        expect(takeMessages()).toEqual([{ type: 'clearBaseline', target: TARGET_KEY }]);
    });

    it('clears the history', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            selected: { history: [historyPoint(Date.now() - DAY, 390_000), historyPoint(Date.now(), 400_000)] },
        }));

        await buttonByText(wrapper, 'Clear history').trigger('click');

        expect(takeMessages()).toEqual([{ type: 'clearHistory', target: TARGET_KEY }]);
    });

    it('explains a package and shows its importers from the package list', async () => {
        const wrapper = await mountDashboard(dashboardModel());
        const packages = section(wrapper, 'packages');

        await packages.find('[aria-label="Explain why lodash-es is included"]').trigger('click');
        await packages.find('[aria-label="Show importers of lodash-es"]').trigger('click');

        expect(takeMessages()).toEqual([
            { type: 'explain', target: TARGET_KEY, packageName: 'lodash-es' },
            { type: 'showImporters', target: TARGET_KEY, packageName: 'lodash-es' },
        ]);
    });

    it('explains a duplicated package', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            selected: {
                duplicates: [{
                    name: 'date-fns',
                    bytes: 21_900,
                    instances: [{ version: '2.30.0', root: 'node_modules/date-fns', bytes: 12_100 }, { version: '3.6.0', root: 'node_modules/x/node_modules/date-fns', bytes: 9_800 }],
                }],
            },
        }));

        await section(wrapper, 'duplicates').find('[aria-label="Explain why date-fns is included"]').trigger('click');

        expect(takeMessages()).toEqual([{ type: 'explain', target: TARGET_KEY, packageName: 'date-fns' }]);
    });

    it('opens a module from the bundle map', async () => {
        const wrapper = await mountDashboard(dashboardModel());
        const map = section(wrapper, 'treemap');

        await map.find('[data-node="group:project"]').trigger('click');
        await map.find('[data-node="module:src/main.ts"]').trigger('click');

        expect(takeMessages()).toEqual([{ type: 'openModule', target: TARGET_KEY, moduleId: 'src/main.ts' }]);
    });

    it('sends nothing when only looking around', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: withBaseline() }));

        await section(wrapper, 'treemap').find('[data-node="group:project"]').trigger('click');
        await buttonByText(section(wrapper, 'packages'), 'Package').trigger('click');
        await section(wrapper, 'packages').find('input[type="search"]').setValue('vue');

        expect(takeMessages()).toEqual([]);
    });
});
