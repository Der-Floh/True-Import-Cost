import { flushPromises, mount } from '@vue/test-utils';
import { expect } from 'vitest';

import { isWebviewMessage } from '../../../shared/messages';
import App from '../../../webview/App.vue';
import { clearPostedMessages, postedMessages } from '../../setup/webview';

import type { DashboardModel } from '../../../shared/dashboard';
import type { DOMWrapper, VueWrapper } from '@vue/test-utils';

export type Dashboard = VueWrapper;

export async function deliver(model: DashboardModel): Promise<void> {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'model', payload: model } }));
    await flushPromises();
}

export async function mountDashboard(model?: DashboardModel): Promise<Dashboard> {
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    if (model !== undefined) {
        await deliver(model);
    }
    clearPostedMessages();
    return wrapper;
}

export function section(wrapper: Dashboard, id: string): DOMWrapper<Element> {
    return wrapper.find(`section[aria-labelledby="${id}-heading"]`);
}

export function buttonByText(scope: Dashboard | DOMWrapper<Element>, text: string): DOMWrapper<HTMLButtonElement> {
    const button = scope.findAll('button').find(candidate => candidate.text().trim() === text);
    if (button === undefined) {
        throw new Error(`No button reads "${text}"`);
    }
    return button;
}

export function textsOf(scope: Dashboard | DOMWrapper<Element>, selector: string): string[] {
    return scope.findAll(selector).map(element => element.text().trim());
}

export function takeMessages(): unknown[] {
    const messages = [...postedMessages];
    for (const message of messages) {
        expect(isWebviewMessage(message), `${JSON.stringify(message)} matches the message contract`).toBe(true);
    }
    clearPostedMessages();
    return messages;
}
