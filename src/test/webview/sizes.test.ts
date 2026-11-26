import { describe, expect, it } from 'vitest';

import { mountDashboard, textsOf } from './support/dashboard';
import { budgetState, dashboardModel, sizeTotals, withBaseline } from './support/model';

import type { Dashboard } from './support/dashboard';

function card(wrapper: Dashboard, label: string) {
    const found = wrapper.findAll('.card').find(candidate => candidate.find('dt').text() === label);
    if (found === undefined) {
        throw new Error(`No card for ${label}`);
    }
    return found;
}

describe('the size cards', () => {
    it('show the six totals with their share', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        expect(textsOf(wrapper, '.card dt')).toEqual(['Total', 'JavaScript', 'CSS', 'Other assets', 'Initial load', 'Lazy']);
        expect(textsOf(wrapper, '.card__value')).toEqual(['400 kB', '300 kB', '20 kB', '80 kB', '250 kB', '70 kB']);
        expect(card(wrapper, 'JavaScript').find('.card__note').text()).toBe('75% of total');
        expect(card(wrapper, 'Initial load').find('.card__note').text()).toBe('78% of JS and CSS');
        expect(card(wrapper, 'Total').find('.card__note').exists()).toBe(false);
    });

    it('have no deltas without a baseline', async () => {
        const wrapper = await mountDashboard(dashboardModel());

        expect(wrapper.findAll('.card__delta')).toHaveLength(0);
    });

    it('describe each change against the baseline in words, with a sign and a tone', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            selected: withBaseline({
                baseline: {
                    label: 'main',
                    source: 'pinned',
                    createdAt: Date.now(),
                    totals: sizeTotals({ total: 390_000, javascript: 302_100, lazy: 70_000 }),
                },
            }),
        }));

        const total = card(wrapper, 'Total').find('.card__delta');
        expect(total.text()).toBe('+10 kB larger');
        expect(total.classes()).toContain('tone-bad');
        expect(total.attributes('title')).toBe('10 kB larger than the baseline, which had 390 kB');
        expect(total.find('svg').exists()).toBe(true);

        const javascript = card(wrapper, 'JavaScript').find('.card__delta');
        expect(javascript.text()).toBe('\u22122.1 kB smaller');
        expect(javascript.classes()).toContain('tone-good');

        const lazy = card(wrapper, 'Lazy').find('.card__delta');
        expect(lazy.text()).toBe('no change');
        expect(lazy.classes()).toContain('tone-neutral');
        expect(lazy.attributes('title')).toBe('The same as the baseline, 70 kB');
        expect(lazy.find('svg').exists()).toBe(false);
    });

    it('state the matching budgets in words, and warn when one is exceeded', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            selected: {
                budgets: [
                    budgetState('total', 500_000, 400_000, 'Total output'),
                    budgetState('initial', 240_000, 250_000, 'Initial load'),
                    budgetState('package', 1_000, 3_000, 'lodash-es'),
                ],
            },
        }));

        const initial = card(wrapper, 'Initial load');
        expect(initial.classes()).toContain('card--over');
        expect(initial.find('.card__budget').text()).toBe('Over 240 kB budget');
        expect(initial.find('.card__budget').classes()).toContain('tone-bad');
        expect(initial.find('.card__budget svg').exists()).toBe(true);
        expect(initial.find('.card__budget').attributes('title')).toBe('Initial load: 250 kB, 10 kB over the budget of 240 kB');

        const total = card(wrapper, 'Total');
        expect(total.classes()).not.toContain('card--over');
        expect(total.find('.card__budget').text()).toBe('Within 500 kB budget');

        expect(card(wrapper, 'JavaScript').find('.card__budget').exists()).toBe(false);
        expect(card(wrapper, 'Lazy').find('.card__budget').exists()).toBe(false);
    });
});
