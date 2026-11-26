import * as vscode from 'vscode';

import { fingerprint } from '../../core/hash';

const MAX_STORED_BYTES = 256 * 1024 * 1024;

export class ExtensionStorage {
    private readonly base: vscode.Uri;

    public constructor(context: vscode.ExtensionContext) {
        this.base = context.storageUri ?? context.globalStorageUri;
    }

    public fileFor(area: string, key: string): vscode.Uri {
        return vscode.Uri.joinPath(this.base, area, `${fingerprint(key)}.json`);
    }

    public areaFor(area: string): vscode.Uri {
        return vscode.Uri.joinPath(this.base, area);
    }

    public async readJson(uri: vscode.Uri): Promise<unknown> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.size > MAX_STORED_BYTES) {
                return undefined;
            }
            return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) as unknown;
        } catch {
            return undefined;
        }
    }

    public async writeJson(uri: vscode.Uri, value: unknown): Promise<void> {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(value)));
    }

    public async remove(uri: vscode.Uri): Promise<void> {
        await Promise.resolve(vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false })).catch(() => undefined);
    }
}
