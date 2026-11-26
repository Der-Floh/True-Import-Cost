import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import manifest from '../../../package.json';
import {
    changeSetting,
    diagnosticCollections,
    emitterListenerCount,
    fireConfigurationChange,
    fireFileWatcher,
    flushFileReads,
    flushFileSearches,
    flushLogs,
    hostListenerCounts,
    outputChannels,
    registeredCommands,
    registeredProviders,
    setActiveTextEditor,
    setSetting,
    setWorkspaceFolders,
    setWorkspaceTrusted,
    statusBarItems,
    treeViews,
    watcherCount,
} from '../__mocks__/vscode';
import { activateExtension, preloadParser, settle, statusBar } from './support/extension';
import { EXTENSION_HOST_METADATA, writeExtensionHost } from './support/fixtures';
import { esbuildMetafile } from './support/metafile';
import { lines, writeJson, writeSource } from './support/workspace';

import type { ActiveExtension } from './support/extension';

const LANGUAGES = manifest.activationEvents.filter(event => event.startsWith('onLanguage:')).map(event => event.slice('onLanguage:'.length));

let extension: ActiveExtension | undefined;

async function activated(): Promise<ActiveExtension> {
    extension = await activateExtension();
    return extension;
}

beforeAll(preloadParser);

beforeEach(() => {
    setWorkspaceFolders('/w');
});

afterEach(() => {
    extension?.deactivate();
    extension = undefined;
});

describe('activation', () => {
    it('registers every command package.json contributes, and no other', async () => {
        await activated();

        expect(registeredCommands()).toEqual(manifest.contributes.commands.map(contribution => contribution.command).sort());
    });

    it('creates every view package.json contributes, each able to collapse all', async () => {
        await activated();

        expect(treeViews().map(view => [view.id, view.showCollapseAll])).toEqual(manifest.contributes.views.trueImportCost.map(view => [view.id, true]));
    });

    it('provides hints, hovers and quick fixes for every language it activates on', async () => {
        await activated();
        const selector = LANGUAGES.map(language => ({ language }));

        expect(registeredProviders('inlayHints').map(registration => registration.selector)).toEqual([selector]);
        expect(registeredProviders('hover').map(registration => registration.selector)).toEqual([selector]);
        expect(registeredProviders('codeActions').map(registration => registration.selector)).toEqual([selector]);
    });

    it('logs that it activated, and what it loaded', async () => {
        writeExtensionHost();
        await activated();

        expect(flushLogs()).toEqual(expect.arrayContaining([
            'info Activated "True Import Cost".',
            'debug Read esbuild metadata for target "extension-host" from file:///w/.true-import-cost/extension-host.json.',
            'info Loaded 1 build target(s), 0 failed.',
        ]));
    });

    it('reads the metadata of a workspace folder that is added', async () => {
        await activated();
        writeJson('/x/.true-import-cost/admin.json', esbuildMetafile({ entry: 'src/admin.ts', inputs: { 'src/admin.ts': { output: 4_000 } } }));
        const admin = writeSource('/x/src/admin.ts', lines('export {};'));

        setWorkspaceFolders('/w', '/x');
        await settle();
        setActiveTextEditor(admin);

        expect(statusBar().text).toBe('$(package) admin · 4 kB');
    });

    it('forgets the metadata of a workspace folder that is removed', async () => {
        setWorkspaceFolders('/w', '/x');
        writeJson('/x/.true-import-cost/admin.json', esbuildMetafile({ entry: 'src/admin.ts', inputs: { 'src/admin.ts': { output: 4_000 } } }));
        await activated();
        expect(statusBar().text).toBe('$(package) admin · 4 kB');

        setWorkspaceFolders('/w');
        await settle();

        expect(statusBar().visible).toBe(false);
    });

    it('reads the metadata again once the workspace is trusted', async () => {
        setWorkspaceTrusted(false);
        await activated();
        writeExtensionHost();

        setWorkspaceTrusted(true);
        await settle();

        expect(statusBar().text).toBe('$(package) extension-host · 74.3 kB');
    });

    it('reads the metadata again when the settings that locate it change', async () => {
        await activated();
        writeJson('/w/build/meta.json', esbuildMetafile({ entry: 'src/main.ts', inputs: { 'src/main.ts': { output: 6_000 } } }));
        setActiveTextEditor(writeSource('/w/src/main.ts', lines('export {};')));

        changeSetting('trueImportCost.targets', [{ id: 'configured', metadata: 'build/meta.json' }]);
        await settle();

        expect(statusBar().text).toBe('$(package) configured · 6 kB');
    });

    it('does not read the metadata again for a setting that only changes how costs are shown', async () => {
        await activated();
        flushFileSearches();

        changeSetting('trueImportCost.display.typeOnly', true);
        fireConfigurationChange('editor.inlayHints.enabled');
        await settle();

        expect(flushFileSearches()).toEqual([]);
    });
});

describe('deactivation', () => {
    it('disposes every registration, listener, watcher, view and item it created', async () => {
        setSetting('trueImportCost.targets', [{ id: 'configured', metadata: 'build/meta.json' }]);
        const document = writeExtensionHost();
        const active = await activated();
        setActiveTextEditor(document);
        expect(Object.keys(hostListenerCounts()).length).toBeGreaterThan(0);
        expect(watcherCount()).toBe(2);

        active.deactivate();

        expect(registeredCommands()).toEqual([]);
        expect((['inlayHints', 'hover', 'codeActions'] as const).flatMap(kind => registeredProviders(kind))).toEqual([]);
        expect(hostListenerCounts()).toEqual({});
        expect(emitterListenerCount()).toBe(0);
        expect(watcherCount()).toBe(0);
        expect(statusBarItems().map(item => [item.disposed, item.visible])).toEqual([[true, false]]);
        expect(treeViews().map(view => view.disposed)).toEqual([true, true]);
        expect(diagnosticCollections().map(collection => collection.disposed)).toEqual([true]);
        expect(outputChannels().at(-1)?.disposed).toBe(true);
    });

    it('stops reloading metadata that changes afterwards', async () => {
        vi.useFakeTimers();
        writeExtensionHost();
        const active = await activated();
        fireFileWatcher('changed', EXTENSION_HOST_METADATA);
        flushFileReads();

        active.deactivate();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(flushFileReads()).toEqual([]);
    });

    it('lets the extension be activated again', async () => {
        writeExtensionHost();
        (await activated()).deactivate();

        await activated();

        expect(registeredCommands()).toHaveLength(manifest.contributes.commands.length);
        expect(statusBar().text).toBe('$(package) extension-host · 74.3 kB');
    });
});
