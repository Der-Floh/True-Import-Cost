import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { writeDashboardTemplate, lastModel, openDashboard, rebuild, send } from './support/dashboard';
import { activateExtension, settle, statusBar } from './support/extension';
import { EXTENSION_HOST_KEY, EXTENSION_HOST_METADATA, extensionHostMetafile, writeExtensionHost } from './support/fixtures';
import { esbuildMetafile } from './support/metafile';
import { writeJson } from './support/workspace';
import {
    flushExecutedCommands,
    flushFileWrites,
    flushLogs,
    readVirtualFile,
    setSetting,
    setWorkspaceFolders,
    webviewPanels,
} from '../__mocks__/vscode';

import type { ActiveExtension } from './support/extension';

let active: ActiveExtension;

async function reactivate(): Promise<void> {
    active.deactivate();
    active = await activateExtension();
}

beforeEach(async () => {
    setWorkspaceFolders('/w');
    writeDashboardTemplate();
    writeExtensionHost();
    active = await activateExtension();
});

describe('the bundle dashboard panel', () => {
    it('opens a page that may run only its own script', async () => {
        const panel = await openDashboard();
        const html = panel.webview.html;
        const nonce = /script-src 'nonce-([0-9a-f]{32})'/.exec(html)?.[1];

        expect(panel.viewType).toBe('trueImportCost.dashboard');
        expect(panel.webview.options.enableScripts).toBe(true);
        expect(panel.webview.options.localResourceRoots?.map(uri => uri.path)).toEqual(['/extension/public']);
        expect(nonce).toBeDefined();
        expect(html).toContain(`<script nonce="${nonce}" src="https://webview.test/extension/public/dashboard.js"></script>`);
        expect(html).toContain('href="https://webview.test/extension/public/dashboard.css"');
        expect(html).not.toMatch(/%[A-Z_]+%/);
    });

    it('is one panel, revealed again rather than opened twice', async () => {
        const first = await openDashboard();
        const second = await openDashboard();

        expect(second).toBe(first);
        expect(first.reveals).toBe(1);
        expect(webviewPanels()).toHaveLength(1);
    });

    it('sends the measured build once the page is ready', async () => {
        const panel = await openDashboard();
        const model = lastModel(panel);

        expect(model.targets.map(target => [target.id, target.totalBytes])).toEqual([['extension-host', 74_300]]);
        expect(model.selected?.totals).toEqual({ total: 74_300, javascript: 74_300, css: 0, assets: 0, initial: 74_300, lazy: 0 });
        expect(model.selected?.packages.map(row => [row.name, row.bytes])).toEqual([['lodash', 70_000], ['tslib', 2_000]]);
        expect(model.selected?.metadataPath).toBe('.true-import-cost/extension-host.json');
    });

    it('ignores a message that breaks the contract', async () => {
        const panel = await openDashboard();
        const posted = panel.webview.posted.length;

        await send(panel, { type: 'openModule', target: EXTENSION_HOST_KEY });
        await send(panel, { type: 'explain', target: EXTENSION_HOST_KEY, packageName: 'lodash', moduleId: 'src/log.ts' });
        await send(panel, 'ready');

        expect(flushExecutedCommands().map(each => each.command)).toEqual(['trueImportCost.showDashboard']);
        expect(panel.webview.posted).toHaveLength(posted);
        expect(flushLogs().filter(line => line.includes('does not match the contract'))).toHaveLength(3);
    });

    it('explains a package and shows its importers through the commands', async () => {
        const panel = await openDashboard();
        flushExecutedCommands();

        await send(panel, { type: 'explain', target: EXTENSION_HOST_KEY, packageName: 'lodash' });
        await send(panel, { type: 'showImporters', target: EXTENSION_HOST_KEY, moduleId: 'src/log.ts' });

        const executed = flushExecutedCommands().filter(each => each.command.startsWith('trueImportCost.') && !each.command.endsWith('.focus'));
        expect(executed).toEqual([
            { command: 'trueImportCost.explainWhyIncluded', args: [{ target: EXTENSION_HOST_KEY, packageName: 'lodash', label: 'lodash' }] },
            { command: 'trueImportCost.showImporters', args: [{ target: EXTENSION_HOST_KEY, modules: ['src/log.ts'] }] },
        ]);
    });

    it('opens a module in the editor', async () => {
        const panel = await openDashboard();
        flushExecutedCommands();

        await send(panel, { type: 'openModule', target: EXTENSION_HOST_KEY, moduleId: 'src/format.ts' });

        const [open] = flushExecutedCommands();
        expect(open?.command).toBe('vscode.open');
        expect((open?.args[0] as vscode.Uri).path).toBe('/w/src/format.ts');
    });

    it('switches to another build target', async () => {
        writeJson('/w/.true-import-cost/webview.json', esbuildMetafile({ entry: 'web/main.ts', inputs: { 'web/main.ts': { output: 9_000 } } }));
        await vscode.commands.executeCommand('trueImportCost.refresh');
        const panel = await openDashboard();
        const webview = lastModel(panel).targets.find(target => target.id === 'webview');

        await send(panel, { type: 'selectTarget', target: webview!.key });

        expect(lastModel(panel).selected?.id).toBe('webview');
        expect(lastModel(panel).comparison?.targets.map(target => target.id)).toEqual(['extension-host', 'webview']);
    });

    it('is opened anew once it was closed', async () => {
        const first = await openDashboard();
        first.dispose();

        const second = await openDashboard();

        expect(second).not.toBe(first);
        expect(first.webview.listenerCount).toBe(0);
    });

    it('waits until it is visible again before it sends a newer build', async () => {
        const panel = await openDashboard();
        panel.setVisible(false);
        const posted = panel.webview.posted.length;

        await rebuild(EXTENSION_HOST_METADATA, extensionHostMetafile(80_000));
        expect(panel.webview.posted).toHaveLength(posted);

        panel.setVisible(true);
        await settle();
        expect(lastModel(panel).selected?.totals.total).toBe(84_300);
    });
});

describe('comparing with a baseline', () => {
    it('pins the current build, keeps it out of the workspace, and shows later changes against it', async () => {
        const panel = await openDashboard();
        flushFileWrites();

        await send(panel, { type: 'pinBaseline', target: EXTENSION_HOST_KEY });
        const written = flushFileWrites();
        await rebuild(EXTENSION_HOST_METADATA, extensionHostMetafile(80_000));
        const model = lastModel(panel);

        expect(written.filter(path => path.startsWith('/storage/workspace/baselines/'))).toHaveLength(1);
        expect(written.filter(path => path.startsWith('/w/'))).toEqual([]);
        expect(model.selected?.baseline).toMatchObject({ source: 'pinned', label: 'Pinned build' });
        expect(model.selected?.packages.find(row => row.name === 'lodash')?.change).toEqual({ status: 'changed', before: 70_000, delta: 10_000, versionsBefore: ['4.17.21'] });
        expect(statusBar().text).toBe('$(package) extension-host · 84.3 kB (+10 kB)');
    });

    it('forgets the baseline when it is cleared', async () => {
        const panel = await openDashboard();
        await send(panel, { type: 'pinBaseline', target: EXTENSION_HOST_KEY });

        await send(panel, { type: 'clearBaseline', target: EXTENSION_HOST_KEY });

        expect(lastModel(panel).selected?.baseline).toBeUndefined();
        expect(statusBar().text).toBe('$(package) extension-host · 74.3 kB');
    });

    it('ignores a stored baseline that is no longer valid', async () => {
        const panel = await openDashboard();
        await send(panel, { type: 'pinBaseline', target: EXTENSION_HOST_KEY });
        const [path] = flushFileWrites().filter(each => each.startsWith('/storage/workspace/baselines/'));
        writeJson(path!, { version: 1, source: 'pinned', label: 'x', savedAt: 1, snapshot: { format: 'nope' } });

        await reactivate();
        const fresh = await openDashboard();

        expect(lastModel(fresh).selected?.baseline).toBeUndefined();
    });
});

describe('the size history', () => {
    it('records each new build once', async () => {
        const panel = await openDashboard();
        expect(lastModel(panel).selected?.history.map(point => point.total)).toEqual([74_300]);

        await rebuild(EXTENSION_HOST_METADATA, extensionHostMetafile(80_000));
        await rebuild(EXTENSION_HOST_METADATA, extensionHostMetafile(80_000));

        expect(lastModel(panel).selected?.history.map(point => point.total)).toEqual([74_300, 84_300]);
    });

    it('is cleared for a target from the dashboard', async () => {
        const panel = await openDashboard();

        await send(panel, { type: 'clearHistory', target: EXTENSION_HOST_KEY });

        expect(lastModel(panel).selected?.history).toEqual([]);
    });

    it('is neither recorded nor shown when it is turned off', async () => {
        setSetting('trueImportCost.history.enabled', false);
        flushFileWrites();
        await reactivate();
        const panel = await openDashboard();

        expect(flushFileWrites().filter(path => path.startsWith('/storage/workspace/history/'))).toEqual([]);
        expect(lastModel(panel).historyEnabled).toBe(false);
        expect(lastModel(panel).selected?.history).toEqual([]);
    });

    it('stores what it records in the extension storage, not the workspace', async () => {
        await openDashboard();
        const stored = (await vscode.workspace.findFiles('**/*.json')).map(uri => uri.path);

        expect(stored.filter(path => path.includes('history'))).toEqual([]);
        expect(readVirtualFile(EXTENSION_HOST_METADATA)).toBeDefined();
    });
});
