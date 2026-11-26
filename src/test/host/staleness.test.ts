import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StalenessTracker } from '../../extension/services/staleness';
import { closeDocument, hostListenerCounts, openDocument, setVirtualFile } from '../__mocks__/vscode';
import { textDocument } from './support/extension';

import type { LoadedTarget } from '../../extension/services/metadataLoader';
import type { FakeTextDocument } from '../__mocks__/vscode';

const BUILT = Date.now() - 60_000;
const PATH = '/w/src/main.ts';

let tracker: StalenessTracker;

function builtAt(createdAt: number): LoadedTarget {
    return { snapshot: { createdAt } } as unknown as LoadedTarget;
}

function isStale(document: FakeTextDocument): Promise<boolean> {
    return tracker.isStale(textDocument(document), builtAt(BUILT));
}

beforeEach(() => {
    tracker = new StalenessTracker();
});

afterEach(() => {
    tracker.dispose();
});

describe('StalenessTracker', () => {
    it('counts a document with unsaved changes as changed since the build', async () => {
        expect(await isStale(openDocument(PATH, '', { isDirty: true }))).toBe(true);
    });

    it('counts a file saved more than a second after the build as changed', async () => {
        setVirtualFile(PATH, '', { mtime: BUILT + 1_001 });

        expect(await isStale(openDocument(PATH, ''))).toBe(true);
    });

    it('allows a second of difference between the clocks', async () => {
        setVirtualFile(PATH, '', { mtime: BUILT + 1_000 });

        expect(await isStale(openDocument(PATH, ''))).toBe(false);
    });

    it('counts a document whose file it cannot stat as unchanged', async () => {
        expect(await isStale(openDocument('/w/src/untitled.ts', ''))).toBe(false);
    });

    it("reads the file's time once, and again after the document is saved", async () => {
        setVirtualFile(PATH, '', { mtime: BUILT - 5_000 });
        const document = openDocument(PATH, '');
        expect(await isStale(document)).toBe(false);

        setVirtualFile(PATH, 'changed outside the editor', { mtime: BUILT + 5_000 });
        expect(await isStale(document)).toBe(false);

        await document.save();
        expect(await isStale(document)).toBe(true);
    });

    it("reads the file's time again once cleared or closed", async () => {
        setVirtualFile(PATH, '', { mtime: BUILT - 5_000 });
        const document = openDocument(PATH, '');
        await isStale(document);

        setVirtualFile(PATH, '', { mtime: BUILT + 5_000 });
        tracker.clear();
        expect(await isStale(document)).toBe(true);

        setVirtualFile(PATH, '', { mtime: BUILT - 5_000 });
        closeDocument(document);
        expect(await isStale(document)).toBe(false);
    });

    it('stops listening for document events once disposed', () => {
        tracker.dispose();

        expect(hostListenerCounts()).toEqual({});
    });
});
