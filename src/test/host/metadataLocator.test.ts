import { beforeEach, describe, expect, it } from 'vitest';

import { locateMetadata } from '../../extension/services/metadataLocator';
import { flushFileSearches, setSetting, setVirtualFile, setWorkspaceFolders } from '../__mocks__/vscode';

import type { MetadataSource } from '../../extension/services/metadataLocator';
import type { FakeWorkspaceFolder } from '../__mocks__/vscode';

const MB = 1024 * 1024;

let web: FakeWorkspaceFolder;
let server: FakeWorkspaceFolder;

function paths(sources: readonly MetadataSource[]): string[] {
    return sources.map(source => source.uri.path);
}

beforeEach(() => {
    [web, server] = setWorkspaceFolders('/w/web', '/w/server') as [FakeWorkspaceFolder, FakeWorkspaceFolder];
});

describe('locateMetadata', () => {
    it('finds the metadata in the .true-import-cost folders of every workspace folder', async () => {
        setVirtualFile('/w/web/.true-import-cost/webview.json', '{}');
        setVirtualFile('/w/web/packages/ui/.true-import-cost/ui.json', '{}');
        setVirtualFile('/w/server/.true-import-cost/node.json', '{}');

        const sources = await locateMetadata([web, server], true);

        expect(paths(sources)).toEqual(['/w/web/.true-import-cost/webview.json', '/w/web/packages/ui/.true-import-cost/ui.json', '/w/server/.true-import-cost/node.json']);
        expect(sources.map(source => source.folder.name)).toEqual(['web', 'web', 'server']);
        expect(sources.every(source => source.setting === undefined)).toBe(true);
    });

    it('leaves out metadata below node_modules, in nested folders and outside .true-import-cost', async () => {
        setVirtualFile('/w/web/node_modules/some-lib/.true-import-cost/lib.json', '{}');
        setVirtualFile('/w/web/.true-import-cost/old/webview.json', '{}');
        setVirtualFile('/w/web/dist/meta.json', '{}');
        setVirtualFile('/w/web/.true-import-cost/notes.txt', '');

        expect(await locateMetadata([web], true)).toEqual([]);
    });

    it('asks the search for at most 100 files per folder and to skip node_modules', async () => {
        await locateMetadata([web, server], true);

        expect(flushFileSearches()).toEqual([
            { include: '/w/web/**/.true-import-cost/*.json', exclude: '**/node_modules/**', maxResults: 100 },
            { include: '/w/server/**/.true-import-cost/*.json', exclude: '**/node_modules/**', maxResults: 100 },
        ]);
    });

    it('adds the targets the settings name, relative to their folder or absolute', async () => {
        setSetting('trueImportCost.targets', [{ id: 'webview', metadata: 'dist/meta.json' }, { metadata: '/srv/builds/web.json' }], web.uri);

        const sources = await locateMetadata([web], true);

        expect(paths(sources)).toEqual(['/w/web/dist/meta.json', '/srv/builds/web.json']);
        expect(sources.map(source => source.setting)).toEqual([{ id: 'webview', metadata: 'dist/meta.json' }, { metadata: '/srv/builds/web.json' }]);
    });

    it('lists a file that is both configured and discovered once, with its setting', async () => {
        setVirtualFile('/w/web/.true-import-cost/webview.json', '{}');
        setSetting('trueImportCost.targets', [{ id: 'renamed', metadata: '.true-import-cost/webview.json' }], web.uri);

        const sources = await locateMetadata([web], true);

        expect(sources).toHaveLength(1);
        expect(sources[0]?.setting?.id).toBe('renamed');
    });

    it('discovers nothing in a folder whose autoDiscover is off, but still reads its targets', async () => {
        setVirtualFile('/w/web/.true-import-cost/webview.json', '{}');
        setVirtualFile('/w/server/.true-import-cost/node.json', '{}');
        setSetting('trueImportCost.autoDiscover', false, web.uri);
        setSetting('trueImportCost.targets', [{ metadata: 'dist/meta.json' }], web.uri);

        expect(paths(await locateMetadata([web, server], true))).toEqual(['/w/web/dist/meta.json', '/w/server/.true-import-cost/node.json']);
    });

    it("gives each source its own folder's size limit", async () => {
        setVirtualFile('/w/web/.true-import-cost/webview.json', '{}');
        setVirtualFile('/w/server/.true-import-cost/node.json', '{}');
        setSetting('trueImportCost.maxMetadataSizeMB', 8, web.uri);

        const sources = await locateMetadata([web, server], true);

        expect(sources.map(source => source.maxBytes)).toEqual([8 * MB, 64 * MB]);
    });

    it('finds nothing and searches nothing while disabled', async () => {
        setVirtualFile('/w/web/.true-import-cost/webview.json', '{}');
        setSetting('trueImportCost.targets', [{ metadata: 'dist/meta.json' }], web.uri);

        expect(await locateMetadata([web, server], false)).toEqual([]);
        expect(flushFileSearches()).toEqual([]);
    });
});
