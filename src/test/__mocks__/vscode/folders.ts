import { hostEvent } from './events';
import { isWithin, relativeTo, sameRoot, Uri } from './uri';

import type { Disposable } from './events';

export interface FakeWorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
}

export interface WorkspaceFoldersChangeEvent {
    readonly added: readonly FakeWorkspaceFolder[];
    readonly removed: readonly FakeWorkspaceFolder[];
}

let folders: FakeWorkspaceFolder[] = [];
const foldersChanged = hostEvent<WorkspaceFoldersChangeEvent>('workspace.onDidChangeWorkspaceFolders');

export function workspaceFolders(): readonly FakeWorkspaceFolder[] | undefined {
    return folders.length === 0 ? undefined : folders;
}

export function getWorkspaceFolder(uri: Uri): FakeWorkspaceFolder | undefined {
    return folders
        .filter(folder => sameRoot(folder.uri, uri) && isWithin(uri.path, folder.uri.path))
        .sort((a, b) => b.uri.path.length - a.uri.path.length)[0];
}

export function asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string {
    const uri = typeof pathOrUri === 'string' ? Uri.file(pathOrUri) : pathOrUri;
    const fallback = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
    const folder = getWorkspaceFolder(uri);
    if (!folder || folder.uri.path === uri.path) {
        return fallback;
    }
    const relative = relativeTo(folder.uri.path, uri.path);
    return (includeWorkspaceFolder ?? folders.length > 1) ? `${folder.name}/${relative}` : relative;
}

export function onDidChangeWorkspaceFolders(listener: (event: WorkspaceFoldersChangeEvent) => unknown): Disposable {
    return foldersChanged.add(listener);
}

export function setWorkspaceFolders(...paths: string[]): FakeWorkspaceFolder[] {
    const removed = folders;
    folders = paths.map((path, index) => {
        const uri = Uri.file(path);
        return { uri, name: uri.path.slice(uri.path.lastIndexOf('/') + 1), index };
    });
    foldersChanged.fire({ added: folders, removed });
    return folders;
}

export function resetFolders(): void {
    folders = [];
}
