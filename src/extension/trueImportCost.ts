import * as vscode from 'vscode';

import { registerCommands } from './commands';
import { DOCUMENT_SELECTOR, View } from './constants';
import { DuplicatePackageDiagnostics, DuplicatePackageQuickFix } from './providers/diagnostics';
import { ImportCostHover } from './providers/hover';
import { ImportCostInlayHints } from './providers/inlayHints';
import { DocumentAnalyzer } from './services/documentAnalyzer';
import { ImportCostService } from './services/importCosts';
import { Logger } from './services/logger';
import { affectsMetadataLocation, affectsSettings, readSettings } from './services/settings';
import { SnapshotStore } from './services/snapshotStore';
import { StalenessTracker } from './services/staleness';
import { TargetSelection } from './services/targetSelection';
import { CurrentTarget } from './views/currentTarget';
import { PackagesTreeProvider } from './views/packagesTree';
import { TargetStatusBar } from './views/statusBar';
import { WhyIncludedTreeProvider } from './views/whyIncludedTree';

import type { Settings } from './services/settings';
import type { PackagesNode } from './views/packagesTree';

export class TrueImportCost implements vscode.Disposable {
    private settings: Settings = readSettings();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly store: SnapshotStore;
    private readonly analyzer: DocumentAnalyzer;
    private readonly staleness: StalenessTracker;
    private readonly service: ImportCostService;
    private readonly current: CurrentTarget;
    private readonly inlayHints: ImportCostInlayHints;
    private readonly diagnostics: DuplicatePackageDiagnostics;
    private readonly statusBar: TargetStatusBar;
    private readonly packages: PackagesTreeProvider;
    private readonly whyIncluded: WhyIncludedTreeProvider;
    private readonly packagesView: vscode.TreeView<PackagesNode>;
    private shownTargetKey: string | undefined;

    public constructor(context: vscode.ExtensionContext) {
        const settings = (): Settings => this.settings;
        const enabled = (): boolean => this.settings.enabled;

        this.store = new SnapshotStore(enabled);
        const selection = new TargetSelection(context.workspaceState);
        this.analyzer = new DocumentAnalyzer(settings);
        this.staleness = new StalenessTracker();
        this.service = new ImportCostService(this.store, selection, this.analyzer, this.staleness);
        this.current = new CurrentTarget(this.store, selection, this.service);
        this.inlayHints = new ImportCostInlayHints(this.service, settings);
        this.diagnostics = new DuplicatePackageDiagnostics(this.service, settings);
        this.statusBar = new TargetStatusBar(this.store, this.current, enabled);
        this.packages = new PackagesTreeProvider(this.current);
        this.whyIncluded = new WhyIncludedTreeProvider();
        this.packagesView = vscode.window.createTreeView(View.packages, { treeDataProvider: this.packages, showCollapseAll: true });
        const whyIncludedView = vscode.window.createTreeView(View.whyIncluded, { treeDataProvider: this.whyIncluded, showCollapseAll: true });

        this.disposables.push(
            this.store,
            selection,
            this.analyzer,
            this.staleness,
            this.inlayHints,
            this.diagnostics,
            this.statusBar,
            this.packages,
            this.whyIncluded,
            this.packagesView,
            whyIncludedView,
            vscode.languages.registerInlayHintsProvider(DOCUMENT_SELECTOR, this.inlayHints),
            vscode.languages.registerHoverProvider(DOCUMENT_SELECTOR, new ImportCostHover(this.service, settings)),
            vscode.languages.registerCodeActionsProvider(DOCUMENT_SELECTOR, new DuplicatePackageQuickFix(this.service), {
                providedCodeActionKinds: DuplicatePackageQuickFix.kinds,
            }),
            ...registerCommands({
                store: this.store,
                service: this.service,
                current: this.current,
                whyIncluded: this.whyIncluded,
                selection,
                settings,
                refresh: () => this.reload(),
                clearCache: () => this.clearCache(),
            }),
            this.store.onDidChange(() => {
                this.staleness.clear();
                this.updateAll(true);
            }),
            selection.onDidChange(() => this.updateAll(true)),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (!affectsSettings(event)) {
                    return;
                }
                this.settings = readSettings();
                if (affectsMetadataLocation(event)) {
                    void this.store.refresh();
                }
                this.updateAll(true);
            }),
            vscode.window.onDidChangeActiveTextEditor(() => this.updateAll(false)),
            vscode.workspace.onDidSaveTextDocument(() => this.statusBar.update()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => void this.store.refresh()),
            vscode.workspace.onDidGrantWorkspaceTrust(() => void this.store.refresh()),
        );

        this.updateAll(true);
        void this.store.refresh();
    }

    public dispose(): void {
        for (const disposable of this.disposables.reverse()) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    private async reload(): Promise<void> {
        this.service.clear();
        await this.store.refresh();
    }

    private async clearCache(): Promise<void> {
        this.service.clear();
        this.diagnostics.clear();
        this.whyIncluded.show(undefined);
        this.store.clear();
        await this.store.refresh();
        Logger.info('Cleared every cache and read the build metadata again.');
    }

    private updateAll(contentChanged: boolean): void {
        if (contentChanged) {
            this.inlayHints.refresh();
            this.diagnostics.refreshAll();
        }
        this.statusBar.update();
        const resolved = this.current.resolve();
        this.packagesView.description = resolved?.target.id;
        if (contentChanged || resolved?.target.key !== this.shownTargetKey) {
            this.shownTargetKey = resolved?.target.key;
            this.packages.refresh();
        }
    }
}
