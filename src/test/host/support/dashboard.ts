import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { expect } from 'vitest';
import * as vscode from 'vscode';

import { settle } from './extension';
import { writeJson } from './workspace';
import { fireFileWatcher, setVirtualFile, webviewPanels } from '../../__mocks__/vscode';
import { BuildGraph } from '../../../core/graph/buildGraph';

import type { FakeWebviewPanel } from '../../__mocks__/vscode';
import type { BuildSnapshot } from '../../../core/schema/snapshot';
import type { LoadedTarget } from '../../../extension/services/metadataLoader';
import type { DashboardModel } from '../../../shared/dashboard';

const TEMPLATE = readFileSync(fileURLToPath(new URL('../../../../media/dashboard.html', import.meta.url)), 'utf8');

const RELOAD_DELAY_MS = 260;

export function writeDashboardTemplate(): void {
    setVirtualFile('/extension/media/dashboard.html', TEMPLATE);
}

export async function openDashboard(): Promise<FakeWebviewPanel> {
    await vscode.commands.executeCommand('trueImportCost.showDashboard');
    await settle();
    const panel = webviewPanels().filter(each => !each.disposed).at(-1);
    expect(panel, 'the dashboard panel').toBeDefined();
    panel!.webview.receive({ type: 'ready' });
    await settle();
    return panel!;
}

export async function send(panel: FakeWebviewPanel, message: unknown): Promise<void> {
    panel.webview.receive(message);
    await settle();
}

export function lastModel(panel: FakeWebviewPanel): DashboardModel {
    const message = panel.webview.posted.at(-1) as { type?: string; payload?: DashboardModel } | undefined;
    expect(message?.type, 'the last message posted to the dashboard').toBe('model');
    return message!.payload!;
}

export async function rebuild(path: string, metafile: unknown): Promise<void> {
    writeJson(path, metafile);
    fireFileWatcher('changed', path);
    await new Promise(resolve => setTimeout(resolve, RELOAD_DELAY_MS));
    await settle();
}

export function loadedTarget(snapshot: BuildSnapshot, id = snapshot.target, key = `file:///w/.true-import-cost/${id}.json`): LoadedTarget {
    return {
        key,
        id,
        source: {
            uri: vscode.Uri.parse(key),
            folder: { uri: vscode.Uri.file('/w'), name: 'w', index: 0 },
            maxBytes: 64 * 1024 * 1024,
        },
        snapshot,
        graph: new BuildGraph(snapshot),
        baseUri: vscode.Uri.file('/w'),
        adapter: 'snapshot',
        fingerprint: `${id}-${snapshot.createdAt}`,
        loadedAt: 0,
    };
}
