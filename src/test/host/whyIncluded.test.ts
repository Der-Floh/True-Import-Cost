import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import {
    flushExecutedCommands,
    flushInformationMessages,
    flushQuickPicks,
    flushWarningMessages,
    setActiveTextEditor,
    setQuickPickChoice,
    setWorkspaceFolders,
} from '../__mocks__/vscode';
import { activateExtension, codeActionsFor, diagnosticsOf, offsetOf, preloadParser, treeChildren, treeProvider } from './support/extension';
import { DUPLICATE_KEY, EXTENSION_HOST_KEY, writeDuplicatedLodash, writeExtensionHost } from './support/fixtures';
import { esbuildMetafile, staticImport } from './support/metafile';
import { writeJson } from './support/workspace';

import type { PackagesNode } from '../../extension/views/packagesTree';
import type { WhyIncludedNode, WhyIncludedTreeProvider } from '../../extension/views/whyIncludedTree';
import type { FakeTextDocument } from '../__mocks__/vscode';
import type { ActiveExtension, TreeEntry } from './support/extension';

let extension: ActiveExtension | undefined;

async function activated(): Promise<void> {
    extension = await activateExtension();
}

function whyIncluded(): WhyIncludedTreeProvider {
    return treeProvider<WhyIncludedNode>('trueImportCost.whyIncluded') as WhyIncludedTreeProvider;
}

function summary({ item }: TreeEntry<WhyIncludedNode>): Record<string, unknown> {
    return { label: item.label, description: item.description, icon: (item.iconPath as vscode.ThemeIcon | undefined)?.id };
}

async function explain(...args: unknown[]): Promise<void> {
    await vscode.commands.executeCommand('trueImportCost.explainWhyIncluded', ...args);
}

async function roots(): Promise<TreeEntry<WhyIncludedNode>[]> {
    return treeChildren(whyIncluded());
}

async function chainsOf(group?: WhyIncludedNode): Promise<TreeEntry<WhyIncludedNode>[]> {
    return treeChildren(whyIncluded(), group);
}

beforeAll(preloadParser);

beforeEach(() => {
    setWorkspaceFolders('/w');
});

afterEach(() => {
    extension?.deactivate();
    extension = undefined;
});

describe('explaining a subject of the extension host build', () => {
    let document: FakeTextDocument;

    beforeEach(async () => {
        document = writeExtensionHost();
        await activated();
        flushExecutedCommands();
    });

    it('shows the import chain from the entry point to a package it is given, and focuses the view', async () => {
        await explain({ target: EXTENSION_HOST_KEY, packageRoot: 'node_modules/lodash', label: 'lodash' });

        const [chain, ...others] = await roots();

        expect(others).toEqual([]);
        expect(summary(chain!)).toEqual({ label: 'via src/extension.ts', description: '1 step from src/extension.ts', icon: 'git-merge' });
        expect(chain!.item.tooltip).toBe('src/extension.ts\n→ lodash/lodash.js');
        expect(chain!.item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
        expect(flushExecutedCommands()).toEqual([
            { command: 'trueImportCost.explainWhyIncluded', args: [{ target: EXTENSION_HOST_KEY, packageRoot: 'node_modules/lodash', label: 'lodash' }] },
            { command: 'trueImportCost.whyIncluded.focus', args: [] },
        ]);
    });

    it('lists the steps of a chain, each opening its file', async () => {
        await explain({ target: EXTENSION_HOST_KEY, packageRoot: 'node_modules/lodash', label: 'lodash' });

        const steps = await chainsOf((await roots())[0]!.node);

        expect(steps.map(summary)).toEqual([
            { label: 'src/extension.ts', description: 'entry point', icon: 'debug-start' },
            { label: 'lodash/lodash.js', description: 'import', icon: 'package' },
        ]);
        expect(steps.map(step => step.item.command?.arguments?.map(String))).toEqual([
            [vscode.Uri.file('/w/src/extension.ts').toString()],
            [vscode.Uri.file('/w/node_modules/lodash/lodash.js').toString()],
        ]);
    });

    it('shows a chain through every module that imports it, shortest first', async () => {
        await explain({ target: EXTENSION_HOST_KEY, packageRoot: 'node_modules/tslib', label: 'tslib' });

        expect((await roots()).map(summary)).toEqual([
            { label: 'via src/format.ts', description: '2 steps from src/extension.ts', icon: 'git-merge' },
            { label: 'via lodash/lodash.js', description: '2 steps from src/extension.ts', icon: 'git-merge' },
        ]);
        expect(whyIncluded().current?.subject).toBe('tslib');
    });

    it('explains the import under the cursor when it is run without arguments', async () => {
        setActiveTextEditor(document, offsetOf(document, "'./format'"));

        await explain();

        expect(whyIncluded().current?.subject).toBe('src/format.ts');
        expect((await roots()).map(summary)).toEqual([{ label: 'via src/extension.ts', description: '1 step from src/extension.ts', icon: 'git-merge' }]);
    });

    it('explains the package or module a Bundle Contents node stands for', async () => {
        const packages = treeProvider<PackagesNode>('trueImportCost.packages');
        const tslib = (await treeChildren(packages)).find(entry => entry.item.label === 'tslib')!;

        await explain(tslib.node);

        expect(whyIncluded().current?.subject).toBe('tslib');
    });

    it('asks for a package or a module when the cursor is on no bundled import', async () => {
        setActiveTextEditor(document, offsetOf(document, 'export function'));
        setQuickPickChoice(item => item.label === '$(package) tslib');

        await explain();

        const [pick] = flushQuickPicks();
        expect(pick?.items.map(item => [item.label, item.description])).toEqual([
            ['Packages', undefined],
            ['$(package) lodash', '4.17.21 · 70 kB'],
            ['$(package) tslib', '2.8.1 · 2 kB'],
            ['Modules', undefined],
            ['$(file-code) lodash/lodash.js', '70 kB'],
            ['$(file-code) tslib/tslib.es6.mjs', '2 kB'],
            ['$(file-code) src/extension.ts', '1.2 kB'],
            ['$(file-code) src/format.ts', '800 B'],
            ['$(file-code) src/log.ts', '300 B'],
        ]);
        expect(pick?.items.filter(item => item.kind === vscode.QuickPickItemKind.Separator).map(item => item.label)).toEqual(['Packages', 'Modules']);
        expect(pick?.options).toEqual({ placeHolder: 'Why is it in "extension-host"? Pick a package or a module', matchOnDescription: true });
        expect(whyIncluded().current?.subject).toBe('tslib');
    });

    it('shows nothing when the pick is cancelled', async () => {
        setQuickPickChoice(undefined);

        await explain();

        expect(await roots()).toEqual([]);
        expect(flushExecutedCommands().map(executed => executed.command)).toEqual(['trueImportCost.explainWhyIncluded']);
    });

    it('warns about a target that is no longer loaded', async () => {
        await explain({ target: vscode.Uri.file('/w/.true-import-cost/gone.json').toString(), packageRoot: 'node_modules/lodash' });

        expect(flushWarningMessages()).toEqual(['That build target is no longer loaded. Refresh and try again.']);
        expect(await roots()).toEqual([]);
    });

    it('warns about a subject the target does not contain', async () => {
        await explain({ target: EXTENSION_HOST_KEY, packageRoot: 'node_modules/left-pad', label: 'left-pad' });

        expect(flushWarningMessages()).toEqual(['"left-pad" is not part of build target "extension-host".']);
    });
});

describe('explaining a package bundled twice', () => {
    it('shows one group for each copy, with the chains that pull it in', async () => {
        const document = writeDuplicatedLodash();
        await activated();
        const [action] = await codeActionsFor(document, diagnosticsOf(document));

        await vscode.commands.executeCommand(action!.command!.command, ...action!.command!.arguments!);

        const groups = await roots();
        expect(groups.map(summary)).toEqual([
            { label: 'lodash 4.17.21', description: '70 kB · node_modules/lodash', icon: 'package' },
            { label: 'lodash 3.10.1', description: '60 kB · node_modules/legacy-widget/node_modules/lodash', icon: 'package' },
        ]);
        expect(groups.map(group => group.item.collapsibleState)).toEqual([vscode.TreeItemCollapsibleState.Expanded, vscode.TreeItemCollapsibleState.Expanded]);
        expect((await chainsOf(groups[0]!.node)).map(summary)).toEqual([{ label: 'via src/main.ts', description: '1 step from src/main.ts', icon: 'git-merge' }]);
        expect((await chainsOf(groups[1]!.node)).map(summary)).toEqual([{ label: 'via legacy-widget/index.js', description: '2 steps from src/main.ts', icon: 'git-merge' }]);
        expect(whyIncluded().current?.subject).toBe('lodash');
        expect(action!.command!.arguments).toEqual([{ target: DUPLICATE_KEY, packageName: 'lodash', label: 'lodash' }]);
    });
});

describe('explaining without a reachable subject', () => {
    it('says no entry point reaches a module nothing imports', async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: { 'src/main.ts': { output: 400 }, 'src/orphan.ts': { output: 90 } },
        }));
        await activated();

        await explain({ target: vscode.Uri.file('/w/.true-import-cost/app.json').toString(), modules: ['src/orphan.ts'], label: 'src/orphan.ts' });

        expect((await roots()).map(summary)).toEqual([{ label: 'No entry point of this build reaches it', description: undefined, icon: 'info' }]);
    });

    it('says a module is imported only by modules no entry point reaches', async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 400 },
                'src/legacy.ts': { output: 90, imports: [staticImport('./orphan', 'src/orphan.ts')] },
                'src/orphan.ts': { output: 90 },
            },
        }));
        await activated();

        await explain({ target: vscode.Uri.file('/w/.true-import-cost/app.json').toString(), modules: ['src/orphan.ts'] });

        expect((await roots()).map(summary)).toEqual([{ label: 'Imported only by modules no entry point reaches', description: undefined, icon: 'info' }]);
    });

    it('says there is nothing to explain while there is no metadata', async () => {
        await activated();

        await explain();

        expect(flushInformationMessages()).toEqual(['True Import Cost has no build metadata to explain yet.']);
    });
});
