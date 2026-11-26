import * as vscode from 'vscode';
import { parse, validate } from 'big-library';
import type { Settings } from './types';
import { DEFAULT_NAME } from './types';
import { unusedThing } from 'unused-lib';
import 'side-effect-lib';
import { used } from 'tree-lib';
import { dup } from 'dup-lib';
import { wrap } from 'wrapper-lib';
import { a } from 'circular-lib';
import { helper } from './helper';
import { shared } from './shared';
import { describeCommand } from './commands';
import { legacy } from './legacy';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const settings: Settings = { name: DEFAULT_NAME };
    const parsed = parse(settings.name);
    const parts = [validate(parsed), used(), dup(), wrap(), a(), helper(), shared(), describeCommand(settings.name), legacy()];
    void vscode.window.showInformationMessage(parts.join(' '));
    const lazy = await import('./lazy');
    context.subscriptions.push({ dispose: lazy.stop });
}
