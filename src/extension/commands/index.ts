import * as vscode from 'vscode';

import { compareBuilds } from './compareBuilds';
import { explainWhyIncluded } from './explainWhyIncluded';
import { importMetadata } from './importMetadata';
import { selectTarget } from './selectTarget';
import { showImporters } from './showImporters';
import { Command, DISPLAY_NAME } from '../constants';
import { forgetConsent } from '../measure/consent';
import { Logger } from '../services/logger';
import { setInlayHintsEnabled } from '../services/settings';

import type { ExplainDependencies } from './explainWhyIncluded';
import type { ImportMeasurer } from '../measure/importMeasurer';
import type { StandaloneMeasurer, StandaloneSizes } from '../measure/standaloneSizes';
import type { BaselineStore } from '../services/baselineStore';
import type { HistoryStore } from '../services/historyStore';
import type { MeasurementStore } from '../services/measurementStore';
import type { Settings } from '../services/settings';
import type { TargetSelection } from '../services/targetSelection';

export interface CommandDependencies extends ExplainDependencies {
    readonly selection: TargetSelection;
    readonly settings: () => Settings;
    readonly baselines: BaselineStore;
    readonly history: HistoryStore;
    readonly measurer: ImportMeasurer;
    readonly measurements: MeasurementStore;
    readonly standalone: StandaloneMeasurer;
    readonly standaloneSizes: StandaloneSizes;
    readonly workspaceState: vscode.Memento;
    readonly refresh: () => Promise<void>;
    readonly clearCache: () => Promise<void>;
    readonly showDashboard: (targetKey?: string) => Promise<void>;
}

async function clearHistory(history: HistoryStore): Promise<void> {
    const confirm = 'Clear History';
    const answer = await vscode.window.showWarningMessage(
        'Forget the recorded size history of every build target in this workspace?',
        { modal: true },
        confirm,
    );
    if (answer === confirm) {
        await history.clearAll();
    }
}

async function forgetMeasurements(dependencies: CommandDependencies): Promise<void> {
    const confirm = 'Forget';
    const answer = await vscode.window.showWarningMessage(
        'Forget every measured import cost and standalone size, and every build command you allowed True Import Cost to run, in this workspace?',
        { modal: true },
        confirm,
    );
    if (answer === confirm) {
        await Promise.all([dependencies.measurements.clearAll(), dependencies.standaloneSizes.clear(), forgetConsent(dependencies.workspaceState)]);
    }
}

function guarded(name: string, run: (...args: unknown[]) => unknown): (...args: unknown[]) => Promise<void> {
    return async (...args: unknown[]) => {
        try {
            await run(...args);
        } catch (error: unknown) {
            const detail = error instanceof Error ? error.message : String(error);
            Logger.error(`Command "${name}" failed: ${detail}`, error);
            void vscode.window.showErrorMessage(`${DISPLAY_NAME}: ${detail}`);
        }
    };
}

export function registerCommands(dependencies: CommandDependencies): vscode.Disposable[] {
    const handlers: Record<string, (...args: unknown[]) => unknown> = {
        [Command.selectTarget]: () => selectTarget(dependencies.store, dependencies.selection),
        [Command.importMetadata]: () => importMetadata(),
        [Command.refresh]: () => dependencies.refresh(),
        [Command.explainWhyIncluded]: (argument?: unknown) => explainWhyIncluded(dependencies, argument),
        [Command.toggleInlayHints]: () => setInlayHintsEnabled(!dependencies.settings().inlayHints),
        [Command.clearCache]: () => dependencies.clearCache(),
        [Command.showLog]: () => Logger.show(),
        [Command.showDashboard]: () => dependencies.showDashboard(),
        [Command.compareBuilds]: () => compareBuilds({ current: dependencies.current, baselines: dependencies.baselines, showDashboard: key => dependencies.showDashboard(key) }),
        [Command.showImporters]: (argument?: unknown) => showImporters(dependencies, argument),
        [Command.clearHistory]: () => clearHistory(dependencies.history),
        [Command.measureImport]: (argument?: unknown) => dependencies.measurer.measure(argument),
        [Command.measureStandalone]: (argument?: unknown) => dependencies.standalone.measure(argument),
        [Command.forgetMeasurements]: () => forgetMeasurements(dependencies),
    };
    return Object.entries(handlers).map(([command, handler]) => vscode.commands.registerCommand(command, guarded(command, handler)));
}
