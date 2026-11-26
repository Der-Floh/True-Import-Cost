import { Uri } from './uri';

import type * as vscode from 'vscode';

export class FakeMemento {
    private readonly values = new Map<string, unknown>();

    public keys(): readonly string[] {
        return [...this.values.keys()];
    }

    public get<T>(key: string, defaultValue?: T): T | undefined {
        return this.values.has(key) ? structuredClone(this.values.get(key)) as T : defaultValue;
    }

    public update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, structuredClone(value));
        }
        return Promise.resolve();
    }
}

export function createExtensionContext(): vscode.ExtensionContext {
    return {
        subscriptions: [],
        workspaceState: new FakeMemento(),
        globalState: new FakeMemento(),
        extensionUri: Uri.file('/extension'),
        storageUri: Uri.file('/storage/workspace'),
        globalStorageUri: Uri.file('/storage/global'),
    } as unknown as vscode.ExtensionContext;
}
