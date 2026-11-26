import { getConfiguration, onDidChangeConfiguration } from './configuration';
import { onDidChangeTextDocument, onDidCloseTextDocument, onDidOpenTextDocument, onDidSaveTextDocument, textDocuments } from './documents';
import { hostEvent } from './events';
import { createFileSystemWatcher, fs, virtualFilePaths } from './fileSystem';
import { asRelativePath, getWorkspaceFolder, onDidChangeWorkspaceFolders, workspaceFolders } from './folders';
import { globMatcher, isWithin, relativeTo, sameRoot, Uri } from './uri';
import { openTextDocument } from './window';

import type { Disposable } from './events';
import type { RelativePattern } from './uri';

export interface FileSearch {
    readonly include: string;
    readonly exclude: string | undefined;
    readonly maxResults: number | undefined;
}

let trusted = true;
const trustGranted = hostEvent<undefined>('workspace.onDidGrantWorkspaceTrust');
let searches: FileSearch[] = [];

function searchRoots(include: RelativePattern | string): Uri[] {
    return typeof include === 'string' ? (workspaceFolders() ?? []).map(folder => folder.uri) : [include.baseUri];
}

function findFiles(include: RelativePattern | string, exclude?: string | null, maxResults?: number): Promise<Uri[]> {
    const glob = typeof include === 'string' ? include : include.pattern;
    searches.push({
        include: typeof include === 'string' ? include : `${include.baseUri.path}/${include.pattern}`,
        exclude: exclude ?? undefined,
        maxResults,
    });
    const included = globMatcher(glob);
    const excluded = exclude ? globMatcher(exclude) : (): boolean => false;
    const found: Uri[] = [];
    for (const path of virtualFilePaths()) {
        const uri = Uri.file(path);
        const root = searchRoots(include).find(candidate => sameRoot(candidate, uri) && isWithin(path, candidate.path) && path !== candidate.path);
        if (root === undefined || !included(relativeTo(root.path, path))) {
            continue;
        }
        const folder = getWorkspaceFolder(uri)?.uri ?? root;
        if (!excluded(relativeTo(folder.path, path))) {
            found.push(uri);
        }
    }
    return Promise.resolve(maxResults === undefined ? found : found.slice(0, maxResults));
}

export const workspace = {
    get workspaceFolders() {
        return workspaceFolders();
    },
    getWorkspaceFolder,
    onDidChangeWorkspaceFolders,
    getConfiguration,
    onDidChangeConfiguration,
    fs,
    findFiles,
    createFileSystemWatcher,
    asRelativePath,
    get isTrusted(): boolean {
        return trusted;
    },
    onDidGrantWorkspaceTrust: (listener: () => unknown): Disposable => trustGranted.add(listener),
    get textDocuments() {
        return textDocuments();
    },
    onDidOpenTextDocument,
    onDidCloseTextDocument,
    onDidChangeTextDocument,
    onDidSaveTextDocument,
    openTextDocument,
};

export function setWorkspaceTrusted(isTrusted: boolean): void {
    const granted = isTrusted && !trusted;
    trusted = isTrusted;
    if (granted) {
        trustGranted.fire(undefined);
    }
}

export function flushFileSearches(): FileSearch[] {
    return searches.splice(0);
}

export function resetWorkspace(): void {
    trusted = true;
    searches = [];
}
