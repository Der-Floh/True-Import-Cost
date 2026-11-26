import * as vscode from 'vscode';

import { explainWhyIncluded } from './explainWhyIncluded';
import { importMetadata } from './importMetadata';
import { selectTarget } from './selectTarget';
import { Command, DISPLAY_NAME } from '../constants';
import { Logger } from '../services/logger';
import { setInlayHintsEnabled } from '../services/settings';

import type { ExplainDependencies } from './explainWhyIncluded';
import type { Settings } from '../services/settings';
import type { TargetSelection } from '../services/targetSelection';

export interface CommandDependencies extends ExplainDependencies {
    readonly selection: TargetSelection;
    readonly settings: () => Settings;
    readonly refresh: () => Promise<void>;
    readonly clearCache: () => Promise<void>;
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
    };
    return Object.entries(handlers).map(([command, handler]) => vscode.commands.registerCommand(command, guarded(command, handler)));
}
