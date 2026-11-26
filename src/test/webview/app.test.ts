import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import App from '../../webview/App.vue';
import { formatDateTime } from '../../webview/format';
import { postedMessages } from '../setup/webview';
import { buttonByText, deliver, mountDashboard, textsOf } from './support/dashboard';
import { dashboardModel, DAY, modelWithoutTarget, otherTargetSummary, targetSummary, withBaseline } from './support/model';

describe('before the host sends a model', () => {
    it('says it is reading the build, as a status', async () => {
        const wrapper = await mountDashboard();

        const status = wrapper.find('[role="status"]');
        expect(status.text()).toBe('Reading the build…');
        expect(wrapper.find('main').attributes('aria-busy')).toBe('true');
    });

    it('tells the host it is ready', () => {
        mount(App);

        expect(postedMessages).toEqual([{ type: 'ready' }]);
    });

    it('ignores messages that are not a model from the extension', async () => {
        const wrapper = await mountDashboard();

        for (const data of [{ type: 'model' }, { type: 'model', payload: [] }, { type: 'other', payload: {} }, 'model', null]) {
            window.dispatchEvent(new MessageEvent('message', { data }));
        }
        await flushPromises();

        expect(wrapper.text()).toContain('Reading the build…');
    });
});

describe('without build metadata', () => {
    it('explains how to produce metadata', async () => {
        const wrapper = await mountDashboard(modelWithoutTarget());

        expect(wrapper.find('h1').text()).toBe('No build metadata yet');
        expect(wrapper.text()).toContain('Write an esbuild metafile or webpack stats into a .true-import-cost folder');
        expect(wrapper.text()).toContain('@true-import-cost/vite');
        expect(wrapper.text()).toContain('@true-import-cost/webpack');
        expect(wrapper.find('main').attributes('aria-busy')).toBe('false');
    });

    it('lists the targets that could not be read', async () => {
        const wrapper = await mountDashboard(modelWithoutTarget([
            otherTargetSummary({ failure: 'the file is not valid JSON' }),
        ]));

        expect(textsOf(wrapper, '.state__failures li')).toEqual(['extension-host: the file is not valid JSON']);
    });
});

describe('with a build target', () => {
    it('shows the target, its bundler, mode, age and metadata file', async () => {
        const model = dashboardModel();
        const wrapper = await mountDashboard(model);

        const header = wrapper.find('header');
        expect(header.find('h1').text()).toBe('webview');
        expect(textsOf(header, '.tag')).toEqual(['vite 8.3.8 (rolldown 1.2.19)', 'production']);
        expect(header.text()).toContain('Built 5 minutes ago');
        expect(header.find('.header__meta [title]').attributes('title')).toBe(formatDateTime(model.selected!.createdAt));
        expect(header.find('.header__path').text()).toBe('.true-import-cost/webview.json');
    });

    it('offers a labelled picker over every target', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            targets: selected => [targetSummary(selected), otherTargetSummary({ failure: 'unreadable' })],
        }));

        const picker = wrapper.find('label.picker');
        expect(picker.find('.picker__label').text()).toBe('Build target');
        expect(picker.find('select').element.value).toBe('file:///w/.true-import-cost/webview.json');
        expect(textsOf(picker, 'option')).toEqual(['webview · 400 kB', 'extension-host · 97.4 kB · could not be updated']);
    });

    it('marks estimated sizes', async () => {
        const exact = await mountDashboard(dashboardModel());
        expect(exact.text()).not.toContain('Estimated sizes');
        exact.unmount();

        const estimated = await mountDashboard(dashboardModel({ selected: { estimated: true } }));
        expect(estimated.find('.tag--warn').text()).toBe('Estimated sizes');
    });

    it('leaves out the mode when the build does not record it', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { mode: undefined } }));

        expect(textsOf(wrapper.find('header'), '.tag')).toEqual(['vite 8.3.8 (rolldown 1.2.19)']);
    });

    it('warns when the latest metadata of the selected target could not be read', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            targets: selected => [targetSummary(selected, { failure: 'Unexpected end of JSON input' })],
        }));

        const notice = wrapper.find('.notice');
        expect(notice.attributes('role')).toBe('status');
        expect(notice.text()).toContain('The latest build metadata of this target could not be read.');
        expect(notice.text()).toContain('Unexpected end of JSON input');
    });

    it("has no failure notice for another target's failure", async () => {
        const wrapper = await mountDashboard(dashboardModel({
            targets: selected => [targetSummary(selected), otherTargetSummary({ failure: 'unreadable' })],
        }));

        expect(wrapper.find('.notice').exists()).toBe(false);
    });

    it('names the baseline, where it came from and its age', async () => {
        const pinned = await mountDashboard(dashboardModel({ selected: withBaseline() }));
        expect(pinned.find('.baseline__text').text()).toBe('Compared with main @ 4f2c1e9 (pinned, built 3 days ago)');
        pinned.unmount();

        const fromFile = await mountDashboard(dashboardModel({
            selected: { baseline: { label: 'release.json', source: 'file', createdAt: Date.now() - DAY, totals: dashboardModel().selected!.totals } },
        }));
        expect(fromFile.find('.baseline__text').text()).toBe('Compared with release.json (from a file, built 1 day ago)');
    });

    it('offers to clear the baseline only when there is one', async () => {
        const without = await mountDashboard(dashboardModel());
        expect(textsOf(without, 'button')).not.toContain('Clear baseline');
        expect(without.text()).toContain('Pin a build as the baseline');
        without.unmount();

        const withOne = await mountDashboard(dashboardModel({ selected: withBaseline() }));
        expect(textsOf(withOne, 'button')).toContain('Clear baseline');
    });

    it('returns the focus to "Pin as baseline" once the cleared baseline is gone', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: withBaseline() }));
        const clear = buttonByText(wrapper, 'Clear baseline');

        clear.element.focus();
        await clear.trigger('click');
        await deliver(dashboardModel());

        expect(document.activeElement).toBe(buttonByText(wrapper, 'Pin as baseline').element);
    });

    it('shows the newly selected target when the host answers with it', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        await deliver(dashboardModel({ selected: { key: 'file:///w/.true-import-cost/extension-host.json', id: 'extension-host' } }));

        expect(wrapper.find('h1').text()).toBe('extension-host');
        expect(wrapper.find('select').element.value).toBe('file:///w/.true-import-cost/extension-host.json');
    });

    it('lays out every section that has data', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        expect(textsOf(wrapper, 'h2')).toEqual(['Sizes', 'Bundle map', 'Packages', 'Size history']);
    });
});
