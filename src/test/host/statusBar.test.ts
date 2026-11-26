import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { changeSetting, openDocument, setActiveTextEditor, setVirtualFile, setWorkspaceFolders } from '../__mocks__/vscode';
import { activateExtension, preloadParser, settle, statusBar } from './support/extension';
import { EXTENSION_HOST_METADATA, writeExtensionHost } from './support/fixtures';
import { esbuildMetafile } from './support/metafile';
import { lines, writeJson, writeSource } from './support/workspace';

import type { ActiveExtension } from './support/extension';

let extension: ActiveExtension | undefined;

async function activated(): Promise<void> {
    extension = await activateExtension();
}

function tooltipText(): string {
    const tooltip = statusBar().tooltip;
    return typeof tooltip === 'string' ? tooltip : tooltip?.value ?? '';
}

beforeAll(preloadParser);

beforeEach(() => {
    setWorkspaceFolders('/w');
});

afterEach(() => {
    extension?.deactivate();
    extension = undefined;
});

describe('the status bar item without metadata', () => {
    it('sits on the right, named after the extension', async () => {
        await activated();

        expect(statusBar()).toMatchObject({ alignment: vscode.StatusBarAlignment.Right, priority: 100, name: 'True Import Cost' });
    });

    it('stays hidden while no supported file is active', async () => {
        await activated();
        setActiveTextEditor(openDocument('/w/README.md', '# Readme'));

        expect(statusBar().visible).toBe(false);
    });

    it('offers to import metadata once a supported file is active', async () => {
        await activated();
        setActiveTextEditor(openDocument('/w/src/main.ts', ''));

        const item = statusBar();

        expect([item.visible, item.text, item.tooltip, item.command]).toEqual([
            true,
            '$(package) No build metadata',
            'True Import Cost has not found any build metadata. Click to import a metafile or snapshot.',
            'trueImportCost.importMetadata',
        ]);
    });

    it('lists why each metadata file it found could not be used', async () => {
        setVirtualFile('/w/.true-import-cost/broken.json', '{');
        writeJson('/w/.true-import-cost/lock.json', { lockfileVersion: 3 });
        await activated();

        const item = statusBar();

        expect([item.visible, item.text, item.command]).toEqual([true, '$(warning) No usable build metadata', 'trueImportCost.importMetadata']);
        expect(tooltipText()).toMatch(/^`\.true-import-cost\/broken\.json`: the file is not valid JSON: .+\n\n`\.true-import-cost\/lock\.json`: the file is neither a True Import Cost snapshot nor build metadata of a supported bundler$/);
    });
});

describe('the status bar item with a build target', () => {
    beforeEach(async () => {
        const document = writeExtensionHost();
        await activated();
        setActiveTextEditor(document);
    });

    it('names the target and the size of its build, and offers to select another', () => {
        const item = statusBar();

        expect([item.visible, item.text, item.command]).toEqual([true, '$(package) extension-host · 74.3 kB', 'trueImportCost.selectTarget']);
    });

    it('describes the build in its tooltip', () => {
        expect(tooltipText()).toBe([
            '**True Import Cost** · `extension-host`',
            '',
            'esbuild',
            '',
            'JavaScript 74\\.3 kB · CSS 0 B · other assets 0 B',
            '',
            '5 modules · 2 packages · built just now',
            '',
            '`.true-import-cost/extension-host.json`',
            '',
            'Click to select another build target.',
        ].join('\n'));
        expect((statusBar().tooltip as vscode.MarkdownString).supportThemeIcons).toBe(true);
    });

    it('says when the active file is not part of the target', () => {
        setActiveTextEditor(openDocument('/w/scripts/release.ts', ''));

        expect(statusBar().text).toBe('$(package) extension-host · 74.3 kB');
        expect(tooltipText()).toContain('\n\nThe active file is not part of this build target.\n\n');
    });

    it('warns that it shows the previous build when the latest cannot be read', async () => {
        setVirtualFile(EXTENSION_HOST_METADATA, '{ "outputs": ');

        await vscode.commands.executeCommand('trueImportCost.refresh');

        expect(statusBar().text).toBe('$(warning) extension-host · 74.3 kB');
        expect(tooltipText()).toMatch(/\$\(warning\) The last update could not be read, so this is the previous build: the file is not valid JSON: /);
    });

    it('is hidden with the extension turned off', async () => {
        changeSetting('trueImportCost.enabled', false);
        await settle();

        expect(statusBar().visible).toBe(false);
    });
});

describe('the status bar item with several build targets', () => {
    it('follows the active editor to the target that contains its file', async () => {
        writeJson('/w/.true-import-cost/node.json', esbuildMetafile({ entry: 'src/server.ts', inputs: { 'src/server.ts': { output: 3_000 } } }));
        writeJson('/w/.true-import-cost/web.json', esbuildMetafile({ entry: 'src/client.ts', inputs: { 'src/client.ts': { output: 9_000 } } }));
        const server = writeSource('/w/src/server.ts', lines('export {};'));
        const client = writeSource('/w/src/client.ts', lines('export {};'));
        await activated();

        setActiveTextEditor(client);
        expect(statusBar().text).toBe('$(package) web · 9 kB');

        setActiveTextEditor(server);
        expect(statusBar().text).toBe('$(package) node · 3 kB');
    });
});
