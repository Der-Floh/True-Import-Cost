import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { lastModel, openDashboard, rebuild, writeDashboardTemplate } from './support/dashboard';
import { activateExtension, diagnosticsOf, settle, statusBar } from './support/extension';
import { EXTENSION_HOST_KEY, EXTENSION_HOST_METADATA, extensionHostMetafile, writeExtensionHost } from './support/fixtures';
import { esbuildMetafile, staticImport } from './support/metafile';
import { lines, writeJson, writeSource } from './support/workspace';
import {
    changeSetting,
    flushErrorMessages,
    flushFileWrites,
    flushInformationMessages,
    flushQuickPicks,
    flushShownDocuments,
    flushWarningMessages,
    setActiveTextEditor,
    setOpenDialogAnswer,
    setQuickPickChoice,
    setVirtualFile,
    setWarningMessageAnswer,
    setWorkspaceFolders,
} from '../__mocks__/vscode';

import type { FakeTextDocument } from '../__mocks__/vscode';

let extension: FakeTextDocument;

beforeEach(async () => {
    setWorkspaceFolders('/w');
    writeDashboardTemplate();
    extension = writeExtensionHost();
    setVirtualFile('/w/src/format.ts', lines("import { log } from './log';", '', 'export function formatSize(size: number): string {', '    log(size);', '    return String(size);', '}'));
    await activateExtension();
});

describe('Compare Builds', () => {
    it('pins the current build as the baseline and opens the dashboard on it', async () => {
        setActiveTextEditor(extension);
        setQuickPickChoice(item => item.label.includes('Pin the current build'));

        await vscode.commands.executeCommand('trueImportCost.compareBuilds');
        await settle();

        const [pick] = flushQuickPicks();
        expect(pick?.items.map(item => item.label)).toEqual(['$(pin) Pin the current build as the baseline', '$(file) Compare with a metadata file…']);
        expect(statusBar().text).toBe('$(package) extension-host · 74.3 kB');
        await rebuild(EXTENSION_HOST_METADATA, extensionHostMetafile(60_000));
        expect(statusBar().text).toBe('$(package) extension-host · 64.3 kB (−10 kB)');
    });

    it('compares with a metadata file it checks first', async () => {
        writeJson('/w/old/meta.json', extensionHostMetafile(90_000));
        setOpenDialogAnswer([vscode.Uri.file('/w/old/meta.json')]);
        setQuickPickChoice(item => item.label.includes('Compare with a metadata file'));
        setActiveTextEditor(extension);

        await vscode.commands.executeCommand('trueImportCost.compareBuilds');
        await settle();
        const panel = await openDashboard();

        expect(lastModel(panel).selected?.baseline).toMatchObject({ source: 'file', label: 'meta.json' });
        expect(lastModel(panel).selected?.packages.find(row => row.name === 'lodash')?.change?.delta).toBe(-20_000);
    });

    it('refuses a file that is not build metadata', async () => {
        setVirtualFile('/w/notes.json', '{ "hello": "world" }');
        setOpenDialogAnswer([vscode.Uri.file('/w/notes.json')]);
        setQuickPickChoice(item => item.label.includes('Compare with a metadata file'));
        setActiveTextEditor(extension);

        await vscode.commands.executeCommand('trueImportCost.compareBuilds');
        await settle();

        expect(flushErrorMessages()).toEqual([expect.stringContaining('cannot compare with notes.json')]);
    });

    it('offers to clear a baseline once there is one', async () => {
        setActiveTextEditor(extension);
        setQuickPickChoice(item => item.label.includes('Pin'));
        await vscode.commands.executeCommand('trueImportCost.compareBuilds');
        await settle();
        flushQuickPicks();

        setQuickPickChoice(item => item.label.includes('Clear the baseline'));
        await vscode.commands.executeCommand('trueImportCost.compareBuilds');
        await settle();

        expect(flushQuickPicks()[0]?.items.at(-1)).toMatchObject({ label: '$(close) Clear the baseline', description: 'Pinned build' });
        await rebuild(EXTENSION_HOST_METADATA, extensionHostMetafile(60_000));
        expect(statusBar().text).toBe('$(package) extension-host · 64.3 kB');
    });
});

describe('Show Importers', () => {
    it('lists every line that imports a module and opens the one picked', async () => {
        setQuickPickChoice(item => item.label.includes('src/format.ts'));

        await vscode.commands.executeCommand('trueImportCost.showImporters', { target: EXTENSION_HOST_KEY, modules: ['src/log.ts'] });

        const [pick] = flushQuickPicks();
        expect(pick?.items.map(item => [item.label, item.description])).toEqual([
            ['$(file-code) src/extension.ts:4', "import { log } from './log';"],
            ['$(file-code) src/format.ts:1', "import { log } from './log';"],
        ]);
        expect(pick?.options?.placeHolder).toBe('2 places import src/log.ts in "extension-host"');
        const [shown] = flushShownDocuments();
        expect(shown?.path).toBe('/w/src/format.ts');
        expect(shown?.selection?.start.line).toBe(0);
    });

    it('names the package an importer inside a package belongs to', async () => {
        await vscode.commands.executeCommand('trueImportCost.showImporters', { target: EXTENSION_HOST_KEY, packageName: 'tslib' });

        const [pick] = flushQuickPicks();
        expect(pick?.items.map(item => [item.label, item.description])).toEqual([
            ['$(file-code) src/format.ts', undefined],
            ['$(package) lodash/lodash.js', 'inside lodash'],
        ]);
    });

    it('works on the import under the cursor', async () => {
        setActiveTextEditor(extension, extension.getText().indexOf("'lodash'"));

        await vscode.commands.executeCommand('trueImportCost.showImporters');

        expect(flushQuickPicks()[0]?.items.map(item => item.label)).toEqual(['$(file-code) src/extension.ts:2']);
    });

    it('says when nothing imports it', async () => {
        await vscode.commands.executeCommand('trueImportCost.showImporters', { target: EXTENSION_HOST_KEY, modules: ['src/extension.ts'] });

        expect(flushInformationMessages()).toEqual(['Nothing in build target "extension-host" imports src/extension.ts; an entry point may load it directly.']);
    });
});

describe('Clear Build History', () => {
    it('forgets the history of every target once confirmed', async () => {
        const panel = await openDashboard();
        expect(lastModel(panel).selected?.history).toHaveLength(1);
        setWarningMessageAnswer('Clear History');

        await vscode.commands.executeCommand('trueImportCost.clearHistory');
        await settle();

        expect(flushWarningMessages()).toEqual(['Forget the recorded size history of every build target in this workspace?']);
        expect(lastModel(panel).selected?.history).toEqual([]);
    });

    it('keeps the history when the question is dismissed', async () => {
        const panel = await openDashboard();
        flushFileWrites();

        await vscode.commands.executeCommand('trueImportCost.clearHistory');
        await settle();

        expect(lastModel(panel).selected?.history).toHaveLength(1);
    });
});

describe('size budgets', () => {
    function budgetCodes(document: FakeTextDocument): [string, unknown, string][] {
        const text = document.getText().split('\n');
        return diagnosticsOf(document).map(diagnostic => [text[diagnostic.range.start.line]!.trim(), diagnostic.code, diagnostic.message]);
    }

    it('warns on an import and a package over their budgets', async () => {
        changeSetting('trueImportCost.budgets', { 'extension-host': { import: '50 kB', packages: { lodash: '60 kB' } } });
        await settle();

        expect(budgetCodes(extension)).toEqual([
            ["import { chunk } from 'lodash';", 'import-budget', 'lodash pulls 72 kB into "extension-host", over the import budget of 50 kB.'],
            ["import { chunk } from 'lodash';", 'package-budget', 'lodash is 70 kB in "extension-host", over its budget of 60 kB.'],
        ]);
    });

    it('applies the budgets for every target', async () => {
        changeSetting('trueImportCost.budgets', { '*': { import: '1 kB' } });
        await settle();

        expect(budgetCodes(extension).map(([line, code]) => [line, code])).toEqual([
            ["import { chunk } from 'lodash';", 'import-budget'],
            ["import { formatSize } from './format';", 'import-budget'],
        ]);
    });

    it('flags a total over budget in the status bar', async () => {
        changeSetting('trueImportCost.budgets', { 'extension-host': { total: '50 kB', initial: '1 MB' } });
        setActiveTextEditor(extension);
        await settle();

        expect(statusBar().text).toBe('$(warning) extension-host · 74.3 kB');
        expect((statusBar().tooltip as vscode.MarkdownString).value).toContain('Total output is 74\\.3 kB, over its budget of 50 kB');
    });

    it('stays quiet without budgets', async () => {
        await settle();

        expect(budgetCodes(extension)).toEqual([]);
    });

    it('applies budgets to a target that becomes larger', async () => {
        changeSetting('trueImportCost.budgets', { 'extension-host': { packages: { lodash: '75 kB' } } });
        await settle();
        expect(budgetCodes(extension)).toEqual([]);

        await rebuild(EXTENSION_HOST_METADATA, extensionHostMetafile(80_000));

        expect(budgetCodes(extension).map(([, code]) => code)).toEqual(['package-budget']);
    });
});

describe('the dashboard of a workspace without metadata', () => {
    it('opens and says there is nothing to show yet', async () => {
        setWorkspaceFolders('/empty');
        await vscode.commands.executeCommand('trueImportCost.refresh');
        const panel = await openDashboard();

        expect(lastModel(panel).targets).toEqual([]);
        expect(lastModel(panel).selected).toBeUndefined();
    });

    it('reads a target added later', async () => {
        writeJson('/w/.true-import-cost/more.json', esbuildMetafile({ entry: 'm.ts', inputs: { 'm.ts': { output: 10, imports: [staticImport('./x', 'x.ts')] }, 'x.ts': { output: 5 } } }));
        writeSource('/w/m.ts', lines("import './x';"));
        await vscode.commands.executeCommand('trueImportCost.refresh');
        const panel = await openDashboard();

        expect(lastModel(panel).targets.map(target => target.id)).toEqual(['extension-host', 'more']);
    });
});
