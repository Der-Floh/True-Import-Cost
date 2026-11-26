import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import {
    flushConfigurationUpdates,
    flushErrorMessages,
    flushInformationMessages,
    flushLogs,
    flushQuickPicks,
    outputChannels,
    setActiveTextEditor,
    setQuickPickChoice,
    setVirtualFile,
    setWorkspaceFolders,
} from '../__mocks__/vscode';
import { activateExtension, inlayHints, inlineCosts, preloadParser, statusBar, treeChildren, treeProvider } from './support/extension';
import { EXTENSION_HOST_KEY, EXTENSION_HOST_METADATA, extensionHostMetafile, writeExtensionHost } from './support/fixtures';
import { esbuildMetafile, staticImport } from './support/metafile';
import { lines, writeJson, writeSource } from './support/workspace';

import type { WhyIncludedNode } from '../../extension/views/whyIncludedTree';
import type { FakeTextDocument } from '../__mocks__/vscode';
import type { ActiveExtension } from './support/extension';

let extension: ActiveExtension | undefined;

async function activated(): Promise<ActiveExtension> {
    extension = await activateExtension();
    return extension;
}

function writeBuild(target: string, lodashBytes: number): void {
    writeJson(`/w/.true-import-cost/${target}.json`, esbuildMetafile({
        entry: 'src/main.ts',
        inputs: {
            'src/main.ts': { output: 1_000, imports: [staticImport('lodash', 'node_modules/lodash/lodash.js')] },
            'node_modules/lodash/lodash.js': { output: lodashBytes },
        },
    }));
}

function keyOf(target: string): string {
    return vscode.Uri.file(`/w/.true-import-cost/${target}.json`).toString();
}

beforeAll(preloadParser);

beforeEach(() => {
    setWorkspaceFolders('/w');
});

afterEach(() => {
    extension?.deactivate();
    extension = undefined;
});

describe('selecting a build target', () => {
    let document: FakeTextDocument;

    beforeEach(async () => {
        writeBuild('node', 70_000);
        writeBuild('web', 40_000);
        document = writeSource('/w/src/main.ts', lines("import { chunk } from 'lodash';", 'chunk([], 1);'));
        await activated();
        setActiveTextEditor(document);
    });

    it('offers Automatic and every target, with its bundler, size and file', async () => {
        await vscode.commands.executeCommand('trueImportCost.selectTarget');

        const [pick] = flushQuickPicks();
        expect(pick?.items).toEqual([
            { label: '$(sparkle) Automatic', description: 'per file, the first target that contains it', picked: true, key: undefined },
            { label: 'node', description: 'esbuild · 71 kB', detail: '.true-import-cost/node.json', key: keyOf('node') },
            { label: 'web', description: 'esbuild · 41 kB', detail: '.true-import-cost/web.json', key: keyOf('web') },
        ]);
        expect(pick?.options).toEqual({ placeHolder: 'Build target the import costs are measured against' });
    });

    it('measures the costs against the first target by default', async () => {
        expect(await inlineCosts(document)).toEqual([["import { chunk } from 'lodash';", '70 kB bundled']]);
        expect(statusBar().text).toBe('$(package) node · 71 kB');
    });

    it('measures the costs against the target picked, and remembers it', async () => {
        setQuickPickChoice(item => item.label === 'web');

        await vscode.commands.executeCommand('trueImportCost.selectTarget');

        expect(await inlineCosts(document)).toEqual([["import { chunk } from 'lodash';", '40 kB bundled']]);
        expect(statusBar().text).toBe('$(package) web · 41 kB');
        expect(extension?.context.workspaceState.get('trueImportCost.selectedTarget')).toBe(keyOf('web'));
    });

    it('marks the selected target, and goes back to automatic when Automatic is picked', async () => {
        setQuickPickChoice(item => item.label === 'web');
        await vscode.commands.executeCommand('trueImportCost.selectTarget');
        flushQuickPicks();

        setQuickPickChoice(item => item.label === '$(sparkle) Automatic');
        await vscode.commands.executeCommand('trueImportCost.selectTarget');

        expect(flushQuickPicks()[0]?.items.map(item => [item.label, item.picked])).toEqual([
            ['$(sparkle) Automatic', false],
            ['node', undefined],
            ['$(check) web', undefined],
        ]);
        expect(await inlineCosts(document)).toEqual([["import { chunk } from 'lodash';", '70 kB bundled']]);
        expect(extension?.context.workspaceState.keys()).toEqual([]);
    });

    it('changes nothing when the pick is cancelled', async () => {
        setQuickPickChoice(undefined);

        await vscode.commands.executeCommand('trueImportCost.selectTarget');

        expect(statusBar().text).toBe('$(package) node · 71 kB');
        expect(extension?.context.workspaceState.keys()).toEqual([]);
    });

    it('says when the last update of a target failed', async () => {
        setVirtualFile('/w/.true-import-cost/web.json', '{');
        await vscode.commands.executeCommand('trueImportCost.refresh');

        await vscode.commands.executeCommand('trueImportCost.selectTarget');

        expect(flushQuickPicks()[0]?.items[2]?.detail).toMatch(/^\.true-import-cost\/web\.json · last update failed: the file is not valid JSON: /);
    });
});

describe('selecting a build target without metadata', () => {
    it('says there is nothing to select', async () => {
        await activated();

        await vscode.commands.executeCommand('trueImportCost.selectTarget');

        expect(flushInformationMessages()).toEqual(['True Import Cost has not found any build metadata yet.']);
        expect(flushQuickPicks()).toEqual([]);
    });
});

describe('toggling inline hints', () => {
    it('turns them off in the user settings, and on again', async () => {
        const document = writeExtensionHost();
        await activated();

        await vscode.commands.executeCommand('trueImportCost.toggleInlayHints');

        expect(flushConfigurationUpdates()).toEqual([{ key: 'trueImportCost.inlayHints.enabled', value: false, target: vscode.ConfigurationTarget.Global }]);
        expect(await inlayHints(document)).toEqual([]);

        await vscode.commands.executeCommand('trueImportCost.toggleInlayHints');

        expect(flushConfigurationUpdates()).toEqual([{ key: 'trueImportCost.inlayHints.enabled', value: true, target: vscode.ConfigurationTarget.Global }]);
        expect(await inlayHints(document)).toHaveLength(6);
    });
});

describe('refreshing', () => {
    it('reads the metadata again', async () => {
        const document = writeExtensionHost();
        await activated();
        writeJson(EXTENSION_HOST_METADATA, extensionHostMetafile(90_000));

        await vscode.commands.executeCommand('trueImportCost.refresh');

        expect(await inlineCosts(document)).toContainEqual(["import { chunk } from 'lodash';", '92 kB bundled · 90 kB exclusive']);
    });
});

describe('clearing the cache', () => {
    it('forgets the explanation shown and reads the metadata again', async () => {
        const document = writeExtensionHost();
        await activated();
        await vscode.commands.executeCommand('trueImportCost.explainWhyIncluded', { target: EXTENSION_HOST_KEY, packageRoot: 'node_modules/lodash' });
        writeJson(EXTENSION_HOST_METADATA, extensionHostMetafile(90_000));
        flushLogs();

        await vscode.commands.executeCommand('trueImportCost.clearCache');

        expect(await treeChildren(treeProvider<WhyIncludedNode>('trueImportCost.whyIncluded'))).toEqual([]);
        expect(await inlineCosts(document)).toContainEqual(["import { chunk } from 'lodash';", '92 kB bundled · 90 kB exclusive']);
        expect(flushLogs()).toContain('info Cleared every cache and read the build metadata again.');
    });
});

describe('showing the log', () => {
    it("reveals the extension's log channel", async () => {
        await activated();

        await vscode.commands.executeCommand('trueImportCost.showLog');

        const channel = outputChannels().at(-1);
        expect([channel?.name, channel?.shown]).toEqual(['True Import Cost', 1]);
    });
});

describe('a command that fails', () => {
    it('reports the error to the user and the log instead of throwing', async () => {
        writeExtensionHost();
        await activated();
        flushLogs();

        await vscode.commands.executeCommand('trueImportCost.explainWhyIncluded', { target: EXTENSION_HOST_KEY, modules: 'src/format.ts' });

        expect(flushErrorMessages()).toEqual([expect.stringMatching(/^True Import Cost: .*filter is not a function$/)]);
        expect(flushLogs()).toEqual([expect.stringMatching(/^error Command "trueImportCost\.explainWhyIncluded" failed: .*filter is not a function$/)]);
    });
});
