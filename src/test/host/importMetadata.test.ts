import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { readFolderSettings } from '../../extension/services/settings';
import {
    flushConfigurationUpdates,
    flushErrorMessages,
    flushInformationMessages,
    flushInputBoxes,
    flushOpenDialogs,
    flushWarningMessages,
    setInputBoxAnswer,
    setOpenDialogAnswer,
    setSetting,
    setVirtualFile,
    setWorkspaceFolders,
    setWorkspaceTrusted,
} from '../__mocks__/vscode';
import { activateExtension, inlineCosts, preloadParser, settle } from './support/extension';
import { EXTENSION_SOURCE, extensionHostMetafile } from './support/fixtures';
import { buildSnapshot } from './support/snapshot';
import { writeJson, writeSource } from './support/workspace';

import type { FakeWorkspaceFolder } from '../__mocks__/vscode';
import type { ActiveExtension } from './support/extension';

let extension: ActiveExtension | undefined;
let folder: FakeWorkspaceFolder;

async function importMetadata(): Promise<void> {
    await vscode.commands.executeCommand('trueImportCost.importMetadata');
}

function choose(path: string | undefined, name?: string): void {
    setOpenDialogAnswer(path === undefined ? undefined : [vscode.Uri.file(path)]);
    setInputBoxAnswer(name);
}

beforeAll(preloadParser);

beforeEach(async () => {
    [folder] = setWorkspaceFolders('/w') as [FakeWorkspaceFolder];
    extension = await activateExtension();
});

afterEach(() => {
    extension?.deactivate();
    extension = undefined;
});

describe('importing build metadata', () => {
    it('asks for a JSON file, starting in the first workspace folder', async () => {
        choose(undefined);

        await importMetadata();

        expect(flushOpenDialogs()).toEqual([{
            canSelectMany: false,
            canSelectFolders: false,
            defaultUri: folder.uri,
            filters: { 'Build metadata': ['json'] },
            openLabel: 'Import',
            title: 'Import an esbuild metafile or a True Import Cost snapshot',
        }]);
        expect(flushInputBoxes()).toEqual([]);
        expect(flushConfigurationUpdates()).toEqual([]);
    });

    it('adds a valid file as a target of its workspace folder, under the name given', async () => {
        writeJson('/w/build/meta.json', extensionHostMetafile());
        choose('/w/build/meta.json', '  extension-host  ');

        await importMetadata();

        expect(flushConfigurationUpdates()).toEqual([{
            key: 'trueImportCost.targets',
            value: [{ id: 'extension-host', metadata: 'build/meta.json' }],
            target: vscode.ConfigurationTarget.WorkspaceFolder,
            folder: '/w',
        }]);
        expect(flushInformationMessages()).toEqual(['Added build target "extension-host" for build/meta.json.']);
    });

    it('starts measuring against the imported target', async () => {
        writeJson('/w/build/meta.json', extensionHostMetafile());
        const document = writeSource('/w/src/extension.ts', EXTENSION_SOURCE);
        choose('/w/build/meta.json', 'extension-host');

        await importMetadata();
        await settle();

        expect(await inlineCosts(document)).toContainEqual(["import * as vscode from 'vscode';", 'external']);
    });

    it('suggests the name the metadata gives its target', async () => {
        writeJson('/w/build/meta.json', extensionHostMetafile());
        writeJson('/w/web/.true-import-cost/vite.json', buildSnapshot({ target: 'webview', modules: [] }));
        choose('/w/build/meta.json', undefined);
        await importMetadata();
        choose('/w/web/.true-import-cost/vite.json', undefined);
        await importMetadata();

        expect(flushInputBoxes().map(({ title, prompt, value }) => ({ title, prompt, value }))).toEqual([
            { title: 'Name of the build target', prompt: 'For example extension-host or webview', value: 'meta' },
            { title: 'Name of the build target', prompt: 'For example extension-host or webview', value: 'webview' },
        ]);
    });

    it('requires a name that is not blank', async () => {
        writeJson('/w/build/meta.json', extensionHostMetafile());
        choose('/w/build/meta.json', undefined);

        await importMetadata();

        const [input] = flushInputBoxes();
        expect(await input?.validateInput?.('   ')).toBe('Enter a name');
        expect(await input?.validateInput?.('webview')).toBeUndefined();
    });

    it('adds nothing when no name is given', async () => {
        writeJson('/w/build/meta.json', extensionHostMetafile());
        choose('/w/build/meta.json', undefined);

        await importMetadata();

        expect(flushConfigurationUpdates()).toEqual([]);
        expect(flushInformationMessages()).toEqual([]);
    });

    it('refuses a file that is not build metadata, saying why, and asks nothing more', async () => {
        setVirtualFile('/w/build/stats.json', '{ "modules": [');
        choose('/w/build/stats.json', 'stats');

        await importMetadata();

        expect(flushErrorMessages()).toEqual([expect.stringMatching(/^True Import Cost cannot use build\/stats\.json: the file is not valid JSON: .+\.$/)]);
        expect(flushInputBoxes()).toEqual([]);
        expect(flushConfigurationUpdates()).toEqual([]);
    });

    it("refuses a file larger than the folder's size limit", async () => {
        setSetting('trueImportCost.maxMetadataSizeMB', 1, folder.uri);
        setVirtualFile('/w/build/meta.json', `${JSON.stringify(extensionHostMetafile())}${' '.repeat(1_200_000)}`);
        choose('/w/build/meta.json', 'big');

        await importMetadata();

        expect(flushErrorMessages()).toEqual([
            'True Import Cost cannot use build/meta.json: the file is 2 MB, above the 1 MB limit set by trueImportCost.maxMetadataSizeMB.',
        ]);
    });

    it('keeps the other targets of the folder and replaces one for the same file', async () => {
        setSetting('trueImportCost.targets', [{ id: 'node', metadata: 'build/node.json' }, { id: 'old', metadata: 'build/meta.json' }], folder.uri);
        writeJson('/w/build/meta.json', extensionHostMetafile());
        choose('/w/build/meta.json', 'extension-host');

        await importMetadata();

        expect(readFolderSettings(folder).targets).toEqual([{ id: 'node', metadata: 'build/node.json' }, { id: 'extension-host', metadata: 'build/meta.json' }]);
    });

    it('stores a file outside the workspace by its absolute path, in the first folder', async () => {
        writeJson('/srv/builds/meta.json', extensionHostMetafile());
        choose('/srv/builds/meta.json', 'shared');

        await importMetadata();

        expect(readFolderSettings(folder).targets).toEqual([{ id: 'shared', metadata: '/srv/builds/meta.json' }]);
        expect(flushInformationMessages()).toEqual(['Added build target "shared" for /srv/builds/meta.json.']);
    });

    it('says Restricted Mode ignores the target until the workspace is trusted', async () => {
        setWorkspaceTrusted(false);
        writeJson('/w/build/meta.json', extensionHostMetafile());
        choose('/w/build/meta.json', 'extension-host');

        await importMetadata();

        expect(flushInformationMessages()).toEqual(['Added build target "extension-host" for build/meta.json. Restricted Mode ignores it until you trust this workspace.']);
    });
});

describe('importing build metadata into a multi-root workspace', () => {
    let server: FakeWorkspaceFolder;

    beforeEach(() => {
        [folder, server] = setWorkspaceFolders('/w/web', '/w/server') as [FakeWorkspaceFolder, FakeWorkspaceFolder];
    });

    it('adds the target to the workspace folder that holds the file', async () => {
        writeJson('/w/server/dist/meta.json', extensionHostMetafile());
        choose('/w/server/dist/meta.json', 'node');

        await importMetadata();

        expect(flushConfigurationUpdates()).toEqual([expect.objectContaining({ value: [{ id: 'node', metadata: 'dist/meta.json' }], folder: '/w/server' })]);
        expect(flushInformationMessages()).toEqual(['Added build target "node" for dist/meta.json.']);
    });

    it('keeps the targets the workspace already gives that folder', async () => {
        setSetting('trueImportCost.targets', [{ id: 'node', metadata: 'dist/node.json' }]);
        writeJson('/w/server/dist/meta.json', extensionHostMetafile());
        choose('/w/server/dist/meta.json', 'worker');
        expect(readFolderSettings(server).targets).toEqual([{ id: 'node', metadata: 'dist/node.json' }]);

        await importMetadata();

        expect(readFolderSettings(server).targets).toEqual([{ id: 'node', metadata: 'dist/node.json' }, { id: 'worker', metadata: 'dist/meta.json' }]);
    });
});

describe('importing build metadata without a folder', () => {
    it("asks to open the project's folder first", async () => {
        setWorkspaceFolders();

        await importMetadata();

        expect(flushWarningMessages()).toEqual(['Open the folder of your project first, so the build metadata can be tied to it.']);
        expect(flushOpenDialogs()).toEqual([]);
    });
});
