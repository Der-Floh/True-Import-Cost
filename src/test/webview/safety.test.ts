import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CodiconIcon from '../../webview/components/CodiconIcon.vue';
import { buttonByText, mountDashboard, section } from './support/dashboard';
import {
    assetGroup,
    budgetState,
    chunkRow,
    dashboardModel,
    DAY,
    historyPoint,
    moduleChange,
    moduleNode,
    OTHER_KEY,
    otherTargetSummary,
    packageNode,
    packageRow,
    rootNode,
    sizeTotals,
    TARGET_KEY,
    targetSummary,
} from './support/model';

const MARKUP = '<img src=x onerror=alert(1)>';

const WEBVIEW = resolve(__dirname, '../../webview');

function vueFiles(): string[] {
    return readdirSync(WEBVIEW, { recursive: true, encoding: 'utf8' })
        .filter(file => file.endsWith('.vue'))
        .map(file => join(WEBVIEW, file));
}

describe('text from the model', () => {
    it('is rendered as text everywhere, never as markup', async () => {
        const wrapper = await mountDashboard(dashboardModel({
            targets: selected => [targetSummary(selected, { failure: MARKUP }), otherTargetSummary({ id: MARKUP })],
            selected: {
                id: MARKUP,
                bundler: MARKUP,
                metadataPath: MARKUP,
                baseline: { label: MARKUP, source: 'file', createdAt: Date.now() - DAY, totals: sizeTotals() },
                treemap: rootNode([packageNode(MARKUP, [moduleNode(`node_modules/${MARKUP}/index.js`, 5_000, { label: MARKUP })], { label: MARKUP })], MARKUP),
                packages: [packageRow(MARKUP, {
                    versions: [MARKUP],
                    duplicate: true,
                    budget: budgetState('package', 1, 2, MARKUP),
                    change: { status: 'changed', before: 1, delta: 1, versionsBefore: [MARKUP] },
                })],
                chunks: [chunkRow(MARKUP, { entry: true, entryModule: MARKUP, delta: 5 })],
                assets: [assetGroup('other', [[MARKUP, 10]])],
                duplicates: [{ name: MARKUP, bytes: 2, instances: [{ version: MARKUP, root: MARKUP, bytes: 1 }, { root: MARKUP, bytes: 1 }] }],
                budgets: [budgetState('total', 1, 2, MARKUP)],
                moduleChanges: [moduleChange(MARKUP, 0, 10)],
                history: [historyPoint(Date.now() - DAY, 10), historyPoint(Date.now(), 20)],
            },
            comparison: { targets: [{ key: TARGET_KEY, id: MARKUP }, { key: OTHER_KEY, id: MARKUP }], rows: [{ name: MARKUP, bytes: [1, null] }] },
        }));
        await section(wrapper, 'chunks').find('.asset__toggle').trigger('click');
        await buttonByText(section(wrapper, 'history'), 'Show as a table').trigger('click');
        await section(wrapper, 'treemap').find('.tile__button').trigger('click');

        expect(document.querySelectorAll('img')).toHaveLength(0);
        expect(document.querySelectorAll('[onerror]')).toHaveLength(0);
        expect(wrapper.text().split(MARKUP).length - 1).toBeGreaterThanOrEqual(20);
        expect(wrapper.html()).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(section(wrapper, 'treemap').find('.tile__label').text()).toBe(MARKUP);
    });
});

describe('injected markup', () => {
    it('is limited to the icon component', () => {
        const injecting = vueFiles().filter(file => readFileSync(file, 'utf8').includes('v-html'));

        expect(injecting).toEqual([join(WEBVIEW, 'components', 'CodiconIcon.vue')]);
    });

    it('comes only from codicons bundled at build time', () => {
        const source = readFileSync(join(WEBVIEW, 'components', 'CodiconIcon.vue'), 'utf8');
        const imports = [...source.matchAll(/^import \w+ from '([^']+)';$/gm)].map(match => match[1]);

        expect(source.match(/v-html="[^"]*"/g)).toEqual(['v-html="svg"']);
        expect(imports.length).toBeGreaterThan(0);
        for (const from of imports) {
            expect(from).toMatch(/^@vscode\/codicons\/src\/icons\/[a-z-]+\.svg\?raw$/);
        }
    });

    it('renders an icon as an inline svg hidden from assistive technology', () => {
        const icon = mount(CodiconIcon, { props: { name: 'refresh' } });

        expect(icon.attributes('aria-hidden')).toBe('true');
        expect(icon.find('svg').attributes('fill')).toBe('currentColor');
    });
});
