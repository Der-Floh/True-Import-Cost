import type { WebviewMessage } from '../shared/messages';
import type { WebviewApi } from 'vscode-webview';

const api: WebviewApi<unknown> | undefined =
    typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

export const isVscode: boolean = api !== undefined;

export function postMessage(message: WebviewMessage): void {
    api?.postMessage(message);
}

export function getState(): unknown {
    return api?.getState();
}

export function setState(state: unknown): void {
    api?.setState(state);
}
