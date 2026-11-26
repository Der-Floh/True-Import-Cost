import { onMounted, onUnmounted, shallowRef } from 'vue';

import { isExtensionMessage, WebviewMessageType } from '../../shared/messages';
import { postMessage } from '../vscode';

import type { DashboardModel } from '../../shared/dashboard';
import type { SubjectReference } from '../../shared/messages';
import type { ShallowRef } from 'vue';

export interface DashboardActions {
    readonly refresh: () => void;
    readonly selectTarget: (target: string) => void;
    readonly openModule: (target: string, moduleId: string) => void;
    readonly explain: (subject: SubjectReference) => void;
    readonly showImporters: (subject: SubjectReference) => void;
    readonly pinBaseline: (target: string) => void;
    readonly compareWithFile: (target: string) => void;
    readonly clearBaseline: (target: string) => void;
    readonly clearHistory: (target: string) => void;
}

export interface Dashboard extends DashboardActions {
    readonly model: ShallowRef<DashboardModel | undefined>;
}

export function useDashboard(): Dashboard {
    const model = shallowRef<DashboardModel | undefined>();

    const receive = (event: MessageEvent<unknown>): void => {
        if (isExtensionMessage(event.data)) {
            model.value = event.data.payload;
        }
    };

    onMounted(() => {
        window.addEventListener('message', receive);
        postMessage({ type: WebviewMessageType.ready });
    });

    onUnmounted(() => {
        window.removeEventListener('message', receive);
    });

    return {
        model,
        refresh: () => postMessage({ type: WebviewMessageType.refresh }),
        selectTarget: target => postMessage({ type: WebviewMessageType.selectTarget, target }),
        openModule: (target, moduleId) => postMessage({ type: WebviewMessageType.openModule, target, moduleId }),
        explain: subject => postMessage({ type: WebviewMessageType.explain, ...subject }),
        showImporters: subject => postMessage({ type: WebviewMessageType.showImporters, ...subject }),
        pinBaseline: target => postMessage({ type: WebviewMessageType.pinBaseline, target }),
        compareWithFile: target => postMessage({ type: WebviewMessageType.compareWithFile, target }),
        clearBaseline: target => postMessage({ type: WebviewMessageType.clearBaseline, target }),
        clearHistory: target => postMessage({ type: WebviewMessageType.clearHistory, target }),
    };
}
