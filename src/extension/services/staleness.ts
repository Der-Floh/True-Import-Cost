import * as vscode from 'vscode';

import type { LoadedTarget } from './metadataLoader';

const CLOCK_TOLERANCE_MS = 1000;

export class StalenessTracker implements vscode.Disposable {
    private readonly modified = new Map<string, Promise<number | undefined>>();
    private readonly subscriptions: vscode.Disposable[];

    public constructor() {
        this.subscriptions = [
            vscode.workspace.onDidSaveTextDocument(document => this.modified.delete(document.uri.toString())),
            vscode.workspace.onDidCloseTextDocument(document => this.modified.delete(document.uri.toString())),
        ];
    }

    public async isStale(document: vscode.TextDocument, target: LoadedTarget): Promise<boolean> {
        if (document.isDirty) {
            return true;
        }
        const modifiedAt = await this.modifiedAt(document.uri);
        return modifiedAt !== undefined && modifiedAt > target.snapshot.createdAt + CLOCK_TOLERANCE_MS;
    }

    public clear(): void {
        this.modified.clear();
    }

    public dispose(): void {
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.modified.clear();
    }

    private modifiedAt(uri: vscode.Uri): Promise<number | undefined> {
        const key = uri.toString();
        let pending = this.modified.get(key);
        if (!pending) {
            pending = Promise.resolve(vscode.workspace.fs.stat(uri)).then(stat => stat.mtime, () => undefined);
            this.modified.set(key, pending);
        }
        return pending;
    }
}
