import * as vscode from 'vscode';
import { parse, validate } from 'big-library';
import 'side-effect-lib';
import { used } from 'tree-lib';
import { dup } from 'dup-lib';
import { wrap } from 'wrapper-lib';
import { a } from 'circular-lib';
import { helper } from './helper.js';
import { shared } from './shared.js';
import { describeCommand } from './commands.js';
import { legacy } from './legacy.js';

export async function activate(context) {
    const parsed = parse('True Import Cost fixture');
    const parts = [validate(parsed), used(), dup(), wrap(), a(), helper(), shared(), describeCommand('fixture'), legacy()];
    void vscode.window.showInformationMessage(parts.join(' '));
    const lazy = await import('./lazy.js');
    context.subscriptions.push({ dispose: lazy.stop });
}
