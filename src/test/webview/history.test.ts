import { describe, expect, it } from 'vitest';

import { formatDateTime } from '../../webview/format';
import { buttonByText, mountDashboard, section, textsOf } from './support/dashboard';
import { dashboardModel, DAY } from './support/model';

import type { Dashboard } from './support/dashboard';
import type { HistoryPointDto } from '../../shared/dashboard';

const DAY_LABEL = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

const START = new Date(2026, 10, 16, 14, 30).getTime();

const POINTS: readonly HistoryPointDto[] = [
    [0, 452_100, 268_400],
    [1.3, 455_800, 270_100],
    [3.1, 461_300, 273_900],
    [4.8, 469_700, 279_800],
    [7.2, 471_000, 284_200],
    [8, 474_900, 285_600],
    [9.3, 480_200, 287_300],
    [10.2, 486_300, 289_900],
].map(([days, total, initial]) => ({
    createdAt: START + days! * DAY,
    total: total!,
    initial: initial!,
    javascript: Math.round(total! * 0.7),
    css: 28_400,
}));

function historyOf(wrapper: Dashboard) {
    return section(wrapper, 'history');
}

describe('the size history', () => {
    it('is left out when history is turned off', async () => {
        const wrapper = await mountDashboard(dashboardModel({ historyEnabled: false, selected: { history: POINTS } }));

        expect(historyOf(wrapper).exists()).toBe(false);
    });

    it('explains that it needs a few builds, without offering to clear nothing', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        expect(historyOf(wrapper).find('.empty').text()).toBe('Size history appears once a few builds have been recorded.');
        expect(textsOf(historyOf(wrapper), 'button')).toEqual([]);
        expect(historyOf(wrapper).find('.history__chart').exists()).toBe(false);
    });

    it('keeps the explanation for a single build, which can be cleared', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { history: POINTS.slice(0, 1) } }));

        expect(historyOf(wrapper).find('.empty').exists()).toBe(true);
        expect(textsOf(historyOf(wrapper), 'button')).toEqual(['Clear history']);
    });

    it('draws a point with a tooltip for every build, oldest first', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { history: [...POINTS].reverse() } }));

        const titles = historyOf(wrapper).findAll('.point title').map(title => title.text());
        expect(titles).toHaveLength(8);
        expect(titles[0]).toBe(`${formatDateTime(START)}\nTotal: 452 kB\nInitial load: 268 kB`);
        expect(titles[7]).toBe(`${formatDateTime(POINTS[7]!.createdAt)}\nTotal: 486 kB\nInitial load: 290 kB`);
        expect(historyOf(wrapper).findAll('.point__dot')).toHaveLength(16);
    });

    it('draws one line per series and names both in the legend with their latest size', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { history: POINTS } }));
        const history = historyOf(wrapper);

        expect(textsOf(history, '.legend__item')).toEqual(['Total 486 kB', 'Initial load 290 kB']);
        for (const line of history.findAll('.series__line')) {
            expect(line.attributes('d')?.match(/[ML]/g)).toEqual(['M', 'L', 'L', 'L', 'L', 'L', 'L', 'L']);
        }
    });

    it('labels the size axis in bytes and the time axis in days', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { history: POINTS } }));
        const labels = textsOf(historyOf(wrapper), '.axis__label');

        expect(labels.slice(0, 6)).toEqual(['250 kB', '300 kB', '350 kB', '400 kB', '450 kB', '500 kB']);
        const days = Array.from({ length: 12 }, (_, index) => DAY_LABEL.format(START + index * DAY));
        expect(labels.slice(6).length).toBeGreaterThanOrEqual(2);
        for (const label of labels.slice(6)) {
            expect(days).toContain(label);
        }
    });

    it('summarises the history for screen readers', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { history: POINTS } }));

        const chart = historyOf(wrapper).find('.history__chart');
        expect(chart.attributes('role')).toBe('img');
        expect(chart.attributes('aria-label')).toBe([
            `Size history of 8 builds, from ${formatDateTime(START)} to ${formatDateTime(POINTS[7]!.createdAt)}.`,
            'Total went from 452 kB to 486 kB, initial load from 268 kB to 290 kB.',
        ].join(' '));
    });

    it('shows the same data as a table on request, newest first', async () => {
        const wrapper = await mountDashboard(dashboardModel({ selected: { history: POINTS } }));
        const toggle = buttonByText(historyOf(wrapper), 'Show as a table');

        expect(toggle.attributes('aria-expanded')).toBe('false');
        await toggle.trigger('click');

        expect(toggle.attributes('aria-expanded')).toBe('true');
        expect(historyOf(wrapper).find(`#${toggle.attributes('aria-controls')}`).element.tagName).toBe('TABLE');
        expect(toggle.text()).toBe('Hide the table');
        const rows = historyOf(wrapper).findAll('tbody tr');
        expect(rows).toHaveLength(8);
        expect(textsOf(rows[0]!, 'th, td')).toEqual([formatDateTime(POINTS[7]!.createdAt), '486 kB', '290 kB', '340 kB', '28.4 kB']);
    });
});
