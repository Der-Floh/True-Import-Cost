import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { SnapshotStore } from '../../extension/services/snapshotStore';
import {
    fireFileWatcher,
    flushFileReads,
    flushFileSearches,
    holdFileRead,
    removeVirtualFile,
    setSetting,
    setVirtualFile,
    setWorkspaceFolders,
    watchedPatterns,
    watcherCount,
} from '../__mocks__/vscode';
import { nextEvent, settle } from './support/extension';
import { esbuildMetafile } from './support/metafile';
import { writeJson } from './support/workspace';

import type { FakeWorkspaceFolder } from '../__mocks__/vscode';

const WEB = '/w/.true-import-cost/web.json';
const NODE = '/w/build/node-meta.json';

let folder: FakeWorkspaceFolder;
let enabled: boolean;
let store: SnapshotStore;
let changes: number;

function writeBuild(path: string, bytes: number): void {
    writeJson(path, esbuildMetafile({ entry: 'src/main.ts', inputs: { 'src/main.ts': { output: bytes } } }));
}

function key(path: string): string {
    return vscode.Uri.file(path).toString();
}

function bytesOf(path: string): number | undefined {
    return store.target(key(path))?.graph.bytesOf('src/main.ts');
}

beforeEach(() => {
    [folder] = setWorkspaceFolders('/w') as [FakeWorkspaceFolder];
    enabled = true;
    store = new SnapshotStore(() => enabled);
    changes = 0;
    store.onDidChange(() => {
        changes++;
    });
});

afterEach(() => {
    store.dispose();
});

describe('refreshing', () => {
    it('loads every metadata file it discovers and every target the settings name', async () => {
        writeBuild(WEB, 500);
        writeBuild(NODE, 800);
        setSetting('trueImportCost.targets', [{ id: 'node', metadata: 'build/node-meta.json' }], folder.uri);

        await store.refresh();

        expect(store.targets().map(target => target.id)).toEqual(['node', 'web']);
        expect([bytesOf(WEB), bytesOf(NODE)]).toEqual([500, 800]);
        expect(changes).toBe(1);
    });

    it('records the metadata it cannot read as failures, with the reason', async () => {
        writeBuild(WEB, 500);
        setVirtualFile('/w/.true-import-cost/broken.json', '{');

        await store.refresh();

        expect(store.targets().map(target => target.id)).toEqual(['web']);
        expect(store.failures().map(failure => [failure.source.uri.path, failure.error])).toEqual([
            ['/w/.true-import-cost/broken.json', expect.stringMatching(/^the file is not valid JSON: /)],
        ]);
        expect(store.failureFor(key('/w/.true-import-cost/broken.json'))).toBeDefined();
    });

    it('watches the discovery pattern of each folder and every configured file', async () => {
        setSetting('trueImportCost.targets', [{ id: 'node', metadata: 'build/node-meta.json' }], folder.uri);

        await store.refresh();

        expect(watchedPatterns()).toEqual(['/w/**/.true-import-cost/*.json', '/w/build/node-meta.json']);
    });

    it('forgets targets whose files a later refresh no longer finds', async () => {
        writeBuild(WEB, 500);
        await store.refresh();

        removeVirtualFile(WEB);
        await store.refresh();

        expect(store.targets()).toEqual([]);
        expect(store.failures()).toEqual([]);
    });

    it('does not bring back a target that a newer refresh dropped', async () => {
        writeBuild(WEB, 500);
        const release = holdFileRead(WEB);
        const first = store.refresh();
        await settle();
        expect(flushFileReads()).toEqual([WEB]);

        setSetting('trueImportCost.autoDiscover', false, folder.uri);
        await store.refresh();
        release();
        await first;

        expect(store.targets()).toEqual([]);
    });

    it('loads nothing and watches nothing while disabled', async () => {
        writeBuild(WEB, 500);
        await store.refresh();

        enabled = false;
        await store.refresh();

        expect(store.targets()).toEqual([]);
        expect(watcherCount()).toBe(0);
    });

    it('forgets everything it loaded when cleared', async () => {
        writeBuild(WEB, 500);
        setVirtualFile('/w/.true-import-cost/broken.json', '{');
        await store.refresh();

        store.clear();

        expect([store.targets(), store.failures()]).toEqual([[], []]);
        expect(changes).toBe(2);
    });
});

describe('watching', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        writeBuild(WEB, 500);
        writeBuild(NODE, 800);
        setSetting('trueImportCost.targets', [{ id: 'node', metadata: 'build/node-meta.json' }], folder.uri);
        await store.refresh();
        flushFileReads();
        flushFileSearches();
        changes = 0;
    });

    it('reloads a target shortly after its file changes', async () => {
        writeBuild(WEB, 650);
        fireFileWatcher('changed', WEB);

        await vi.advanceTimersByTimeAsync(249);
        expect([bytesOf(WEB), changes]).toEqual([500, 0]);

        const changed = nextEvent(store.onDidChange);
        await vi.advanceTimersByTimeAsync(1);
        await changed;

        expect(bytesOf(WEB)).toBe(650);
        expect(changes).toBe(1);
    });

    it('reads a burst of changes once', async () => {
        for (let index = 0; index < 5; index++) {
            writeBuild(NODE, 900 + index);
            fireFileWatcher('changed', NODE);
            await vi.advanceTimersByTimeAsync(100);
        }
        await vi.advanceTimersByTimeAsync(250);

        expect(flushFileReads()).toEqual([NODE]);
        expect(bytesOf(NODE)).toBe(904);
    });

    it('keeps the last good snapshot when a rebuild cannot be read, and records why', async () => {
        const before = store.target(key(WEB));
        setVirtualFile(WEB, '{ "inputs": {');
        fireFileWatcher('changed', WEB);

        await vi.advanceTimersByTimeAsync(250);

        expect(store.target(key(WEB))).toBe(before);
        expect(store.targets().map(target => target.id)).toEqual(['node', 'web']);
        expect(store.failureFor(key(WEB))?.error).toMatch(/^the file is not valid JSON: /);
        expect(changes).toBe(1);
    });

    it('clears the failure once the file can be read again', async () => {
        setVirtualFile(WEB, '{');
        fireFileWatcher('changed', WEB);
        await vi.advanceTimersByTimeAsync(250);

        writeBuild(WEB, 700);
        fireFileWatcher('changed', WEB);
        await vi.advanceTimersByTimeAsync(250);

        expect(store.failureFor(key(WEB))).toBeUndefined();
        expect(bytesOf(WEB)).toBe(700);
    });

    it('drops a discovered target as soon as its file is deleted', () => {
        removeVirtualFile(WEB);
        fireFileWatcher('deleted', WEB);

        expect(store.targets().map(target => target.id)).toEqual(['node']);
        expect(store.failures()).toEqual([]);
        expect(changes).toBe(1);
    });

    it('keeps a deleted configured target as a failure and loads it again when the file comes back', async () => {
        removeVirtualFile(NODE);
        fireFileWatcher('deleted', NODE);

        expect(store.targets().map(target => target.id)).toEqual(['web']);
        expect(store.failureFor(key(NODE))?.error).toBe('the file was deleted');

        writeBuild(NODE, 820);
        fireFileWatcher('created', NODE);
        await vi.advanceTimersByTimeAsync(250);

        expect(store.failureFor(key(NODE))).toBeUndefined();
        expect(bytesOf(NODE)).toBe(820);
    });

    it('picks up a metadata file that appears in a .true-import-cost folder', async () => {
        writeBuild('/w/apps/admin/.true-import-cost/admin.json', 300);
        fireFileWatcher('created', '/w/apps/admin/.true-import-cost/admin.json');

        await vi.advanceTimersByTimeAsync(250);

        expect(store.targets().map(target => target.id)).toEqual(['admin', 'node', 'web']);
        expect(flushFileSearches()).toHaveLength(1);
    });

    it('ends with the newest build when an earlier reload finishes last', async () => {
        writeBuild(WEB, 600);
        const release = holdFileRead(WEB);
        fireFileWatcher('changed', WEB);
        await vi.advanceTimersByTimeAsync(250);

        writeBuild(WEB, 700);
        fireFileWatcher('changed', WEB);
        await vi.advanceTimersByTimeAsync(250);
        expect(bytesOf(WEB)).toBe(700);
        release();
        await vi.advanceTimersByTimeAsync(0);

        expect(bytesOf(WEB)).toBe(700);
    });

    it('reloads a configured target whose file name has glob characters in it', async () => {
        const STATS = '/w/build/stats[web].json';
        writeBuild(STATS, 500);
        setSetting('trueImportCost.targets', [{ id: 'stats', metadata: 'build/stats[web].json' }], folder.uri);
        await store.refresh();

        writeBuild(STATS, 650);
        fireFileWatcher('changed', STATS);
        await vi.advanceTimersByTimeAsync(250);

        expect(bytesOf(STATS)).toBe(650);
    });

    it('stops watching and never reloads once disposed', async () => {
        writeBuild(WEB, 650);
        fireFileWatcher('changed', WEB);

        store.dispose();
        await vi.advanceTimersByTimeAsync(1000);

        expect(watcherCount()).toBe(0);
        expect(flushFileReads()).toEqual([]);
        expect(changes).toBe(0);
    });
});

describe('targetsContaining', () => {
    it('lists the targets whose build holds the document', async () => {
        writeBuild(WEB, 500);
        writeJson('/w/.true-import-cost/other.json', esbuildMetafile({ entry: 'src/other.ts', inputs: { 'src/other.ts': { output: 10 } } }));
        await store.refresh();

        expect(store.targetsContaining(vscode.Uri.file('/w/src/main.ts')).map(target => target.id)).toEqual(['web']);
        expect(store.targetsContaining(vscode.Uri.file('/w/src/unknown.ts'))).toEqual([]);
        expect(store.targetsContaining(vscode.Uri.parse('untitled:/w/src/main.ts'))).toEqual([]);
    });
});
