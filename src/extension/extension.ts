import { DISPLAY_NAME } from './constants';
import { Logger } from './services/logger';
import { TrueImportCost } from './trueImportCost';

import type * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
    Logger.initialize(context, DISPLAY_NAME);
    context.subscriptions.push(new TrueImportCost(context));
    Logger.info(`Activated "${DISPLAY_NAME}".`);
}

export function deactivate(): void { }
