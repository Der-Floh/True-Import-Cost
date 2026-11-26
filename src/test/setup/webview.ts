import { enableAutoUnmount } from '@vue/test-utils';
import { afterEach, beforeEach } from 'vitest';

export const postedMessages: unknown[] = [];

let state: unknown;

export function clearPostedMessages(): void {
    postedMessages.length = 0;
}

export function savedState(): unknown {
    return state;
}

(globalThis as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => {
        postedMessages.push(message);
    },
    getState: () => state,
    setState: (value: unknown) => {
        state = value;
        return value;
    },
});

enableAutoUnmount(afterEach);

beforeEach(() => {
    clearPostedMessages();
    state = undefined;
});
