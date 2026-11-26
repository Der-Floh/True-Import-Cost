import type { DashboardModel } from './dashboard';

export const ExtensionMessageType = {
    model: 'model',
} as const;
export type ExtensionMessageType = typeof ExtensionMessageType[keyof typeof ExtensionMessageType];

export type ExtensionMessage =
    | { readonly type: typeof ExtensionMessageType.model; readonly payload: DashboardModel };

export const WebviewMessageType = {
    ready: 'ready',
    refresh: 'refresh',
    selectTarget: 'selectTarget',
    openModule: 'openModule',
    explain: 'explain',
    showImporters: 'showImporters',
    pinBaseline: 'pinBaseline',
    compareWithFile: 'compareWithFile',
    clearBaseline: 'clearBaseline',
    clearHistory: 'clearHistory',
} as const;
export type WebviewMessageType = typeof WebviewMessageType[keyof typeof WebviewMessageType];

export interface SubjectReference {
    readonly target: string;
    readonly packageName?: string;
    readonly moduleId?: string;
}

export type WebviewMessage =
    | { readonly type: typeof WebviewMessageType.ready }
    | { readonly type: typeof WebviewMessageType.refresh }
    | { readonly type: typeof WebviewMessageType.selectTarget; readonly target: string }
    | { readonly type: typeof WebviewMessageType.openModule; readonly target: string; readonly moduleId: string }
    | ({ readonly type: typeof WebviewMessageType.explain } & SubjectReference)
    | ({ readonly type: typeof WebviewMessageType.showImporters } & SubjectReference)
    | { readonly type: typeof WebviewMessageType.pinBaseline; readonly target: string }
    | { readonly type: typeof WebviewMessageType.compareWithFile; readonly target: string }
    | { readonly type: typeof WebviewMessageType.clearBaseline; readonly target: string }
    | { readonly type: typeof WebviewMessageType.clearHistory; readonly target: string };

const MAX_FIELD_LENGTH = 4096;

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value !== '' && value.length <= MAX_FIELD_LENGTH;
}

function isOneOf<T extends string>(value: unknown, allowed: Readonly<Record<string, T>>): value is T {
    return typeof value === 'string' && (Object.values(allowed) as string[]).includes(value);
}

function isSubject(message: Record<string, unknown>): boolean {
    const hasPackage = message.packageName !== undefined;
    const hasModule = message.moduleId !== undefined;
    return isText(message.target)
        && hasPackage !== hasModule
        && (!hasPackage || isText(message.packageName))
        && (!hasModule || isText(message.moduleId));
}

const targetOnly = (message: Record<string, unknown>): boolean => isText(message.target);

const WEBVIEW_MESSAGE_GUARDS: { readonly [K in WebviewMessageType]: (message: Record<string, unknown>) => boolean } = {
    ready: () => true,
    refresh: () => true,
    selectTarget: targetOnly,
    openModule: message => isText(message.target) && isText(message.moduleId),
    explain: isSubject,
    showImporters: isSubject,
    pinBaseline: targetOnly,
    compareWithFile: targetOnly,
    clearBaseline: targetOnly,
    clearHistory: targetOnly,
};

export function isWebviewMessage(value: unknown): value is WebviewMessage {
    const message = asRecord(value);
    if (message === undefined || !isOneOf(message.type, WebviewMessageType)) {
        return false;
    }
    return WEBVIEW_MESSAGE_GUARDS[message.type](message);
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
    const message = asRecord(value);
    return message !== undefined && isOneOf(message.type, ExtensionMessageType) && asRecord(message.payload) !== undefined;
}
