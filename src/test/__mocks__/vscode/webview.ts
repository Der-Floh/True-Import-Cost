import { Listeners } from './events';
import { Uri } from './uri';

import type { Disposable } from './events';

export const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2 } as const;

export interface WebviewPanelOptions {
    readonly enableScripts?: boolean;
    readonly localResourceRoots?: readonly Uri[];
    readonly retainContextWhenHidden?: boolean;
}

export class FakeWebview {
    public html = '';
    public readonly cspSource = 'https://webview.test';
    public readonly options: WebviewPanelOptions;
    public readonly posted: unknown[] = [];
    private readonly received = new Listeners<unknown>();

    public constructor(options: WebviewPanelOptions) {
        this.options = options;
    }

    public asWebviewUri(uri: Uri): Uri {
        return Uri.parse(`https://webview.test${uri.path}`);
    }

    public postMessage(message: unknown): Promise<boolean> {
        this.posted.push(structuredClone(message));
        return Promise.resolve(true);
    }

    public onDidReceiveMessage(listener: (message: unknown) => unknown): Disposable {
        return this.received.add(listener);
    }

    public receive(message: unknown): void {
        this.received.fire(message);
    }

    public get listenerCount(): number {
        return this.received.count;
    }
}

export class FakeWebviewPanel {
    public readonly viewType: string;
    public title: string;
    public readonly viewColumn: number;
    public readonly webview: FakeWebview;
    public iconPath: unknown;
    public visible = true;
    public disposed = false;
    public reveals = 0;
    private readonly disposeListeners = new Listeners<undefined>();
    private readonly viewStateListeners = new Listeners<{ readonly webviewPanel: FakeWebviewPanel }>();

    public constructor(viewType: string, title: string, viewColumn: number, options: WebviewPanelOptions) {
        this.viewType = viewType;
        this.title = title;
        this.viewColumn = viewColumn;
        this.webview = new FakeWebview(options);
    }

    public reveal(): void {
        this.reveals++;
        this.setVisible(true);
    }

    public onDidDispose(listener: () => unknown): Disposable {
        return this.disposeListeners.add(listener);
    }

    public onDidChangeViewState(listener: (event: { readonly webviewPanel: FakeWebviewPanel }) => unknown): Disposable {
        return this.viewStateListeners.add(listener);
    }

    public setVisible(visible: boolean): void {
        if (this.visible !== visible) {
            this.visible = visible;
            this.viewStateListeners.fire({ webviewPanel: this });
        }
    }

    public dispose(): void {
        if (!this.disposed) {
            this.disposed = true;
            this.visible = false;
            this.disposeListeners.fire(undefined);
        }
    }
}

let panels: FakeWebviewPanel[] = [];

export function createWebviewPanel(viewType: string, title: string, viewColumn: number, options: WebviewPanelOptions = {}): FakeWebviewPanel {
    const panel = new FakeWebviewPanel(viewType, title, viewColumn, options);
    panels.push(panel);
    return panel;
}

export function webviewPanels(): readonly FakeWebviewPanel[] {
    return panels;
}

export function resetWebviews(): void {
    panels = [];
}
