import * as vscode from 'vscode';

import { buildDashboardModel } from './dashboardModel';
import { dashboardHtml, localResourceRoots } from './webviewHtml';
import { Command, DISPLAY_NAME } from '../constants';
import { budgetFor } from '../../core/budgets';
import { ExtensionMessageType, isWebviewMessage, WebviewMessageType } from '../../shared/messages';
import { Logger } from '../services/logger';
import { moduleUri } from '../views/packagesTree';

import type { BaselineStore } from '../services/baselineStore';
import type { HistoryStore } from '../services/historyStore';
import type { LoadedTarget } from '../services/metadataLoader';
import type { Settings } from '../services/settings';
import type { SnapshotStore } from '../services/snapshotStore';
import type { CurrentTarget } from '../views/currentTarget';
import type { DashboardModel } from '../../shared/dashboard';
import type { ExtensionMessage, SubjectReference, WebviewMessage } from '../../shared/messages';
import type { ExplainArguments } from '../presentation/hoverContent';

export interface DashboardDependencies {
    readonly extensionUri: vscode.Uri;
    readonly store: SnapshotStore;
    readonly current: CurrentTarget;
    readonly baselines: BaselineStore;
    readonly history: HistoryStore;
    readonly settings: () => Settings;
    readonly reload: () => Promise<void>;
    readonly compareWithFile: (target: LoadedTarget) => Promise<void>;
}

export const DASHBOARD_VIEW_TYPE = 'trueImportCost.dashboard';

export function subjectArguments(subject: SubjectReference): ExplainArguments {
    return subject.packageName === undefined
        ? { target: subject.target, modules: subject.moduleId === undefined ? [] : [subject.moduleId] }
        : { target: subject.target, packageName: subject.packageName, label: subject.packageName };
}

export class DashboardPanel implements vscode.Disposable {
    private readonly dependencies: DashboardDependencies;
    private panel: vscode.WebviewPanel | undefined;
    private panelSubscriptions: vscode.Disposable[] = [];
    private selectedKey: string | undefined;
    private sequence = 0;

    public constructor(dependencies: DashboardDependencies) {
        this.dependencies = dependencies;
    }

    public get isOpen(): boolean {
        return this.panel !== undefined;
    }

    public async show(targetKey?: string): Promise<void> {
        if (targetKey !== undefined) {
            this.selectedKey = targetKey;
        }
        if (this.panel) {
            this.panel.reveal();
            await this.post();
            return;
        }
        const { extensionUri } = this.dependencies;
        const panel = vscode.window.createWebviewPanel(DASHBOARD_VIEW_TYPE, 'Bundle Dashboard', vscode.ViewColumn.Active, {
            enableScripts: true,
            localResourceRoots: localResourceRoots(extensionUri),
        });
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'assets', 'icon-x512.png');
        this.panel = panel;
        this.panelSubscriptions = [
            panel.webview.onDidReceiveMessage((message: unknown) => this.receive(message)),
            panel.onDidChangeViewState((event) => {
                if (event.webviewPanel.visible) {
                    void this.post();
                }
            }),
            panel.onDidDispose(() => this.forgetPanel(panel)),
        ];
        panel.webview.html = await dashboardHtml(panel.webview, extensionUri);
    }

    public refresh(): void {
        if (this.panel?.visible === true) {
            void this.post();
        }
    }

    public dispose(): void {
        this.panel?.dispose();
        this.forgetPanel(this.panel);
    }

    public selectedTarget(): LoadedTarget | undefined {
        const { store, current } = this.dependencies;
        const targets = store.targets();
        return targets.find(target => target.key === this.selectedKey) ?? current.resolve()?.target ?? targets[0];
    }

    public async model(): Promise<DashboardModel> {
        const { store, baselines, history } = this.dependencies;
        const settings = this.dependencies.settings();
        const targets = store.targets().map((target) => {
            const failure = store.failureFor(target.key)?.error;
            return failure === undefined ? { target } : { target, failure };
        });
        const target = this.selectedTarget();
        if (!target) {
            return buildDashboardModel({ targets, historyEnabled: settings.historyEnabled });
        }
        const [baseline, entries] = await Promise.all([
            baselines.get(target.key),
            settings.historyEnabled ? history.entries(target.key) : Promise.resolve([]),
        ]);
        const budget = budgetFor(settings.budgets, target.id);
        return buildDashboardModel({
            targets,
            selected: {
                target,
                metadataPath: vscode.workspace.asRelativePath(target.source.uri),
                ...(baseline === undefined ? {} : { baseline }),
                history: entries,
                ...(budget === undefined ? {} : { budget }),
            },
            historyEnabled: settings.historyEnabled,
        });
    }

    private forgetPanel(panel: vscode.WebviewPanel | undefined): void {
        if (panel === undefined || panel !== this.panel) {
            return;
        }
        this.panel = undefined;
        for (const subscription of this.panelSubscriptions) {
            subscription.dispose();
        }
        this.panelSubscriptions = [];
    }

    private async post(): Promise<void> {
        const panel = this.panel;
        if (!panel) {
            return;
        }
        const sequence = ++this.sequence;
        const model = await this.model();
        if (sequence !== this.sequence || panel !== this.panel) {
            return;
        }
        const message: ExtensionMessage = { type: ExtensionMessageType.model, payload: model };
        await panel.webview.postMessage(message);
    }

    private async receive(message: unknown): Promise<void> {
        if (!isWebviewMessage(message)) {
            Logger.warn('Ignored a message from the dashboard that does not match the contract.');
            return;
        }
        try {
            await this.handle(message);
        } catch (error: unknown) {
            const detail = error instanceof Error ? error.message : String(error);
            Logger.error(`Handling "${message.type}" from the dashboard failed: ${detail}`, error);
            void vscode.window.showErrorMessage(`${DISPLAY_NAME}: ${detail}`);
        }
    }

    private targetOf(key: string): LoadedTarget | undefined {
        const target = this.dependencies.store.target(key);
        if (!target) {
            void vscode.window.showWarningMessage('That build target is no longer loaded.');
        }
        return target;
    }

    private async handle(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case WebviewMessageType.ready:
                return this.post();
            case WebviewMessageType.refresh:
                await this.dependencies.reload();
                return this.post();
            case WebviewMessageType.selectTarget:
                this.selectedKey = message.target;
                return this.post();
            case WebviewMessageType.openModule: {
                const target = this.targetOf(message.target);
                const uri = target === undefined ? undefined : moduleUri(target, message.moduleId);
                if (uri) {
                    await vscode.commands.executeCommand('vscode.open', uri);
                }
                return undefined;
            }
            case WebviewMessageType.explain:
                await vscode.commands.executeCommand(Command.explainWhyIncluded, subjectArguments(message));
                return undefined;
            case WebviewMessageType.showImporters:
                await vscode.commands.executeCommand(Command.showImporters, subjectArguments(message));
                return undefined;
            case WebviewMessageType.pinBaseline: {
                const target = this.targetOf(message.target);
                return target === undefined ? undefined : this.dependencies.baselines.pin(target);
            }
            case WebviewMessageType.compareWithFile: {
                const target = this.targetOf(message.target);
                return target === undefined ? undefined : this.dependencies.compareWithFile(target);
            }
            case WebviewMessageType.clearBaseline:
                return this.dependencies.baselines.clear(message.target);
            case WebviewMessageType.clearHistory:
                return this.dependencies.history.clear(message.target);
        }
    }
}
