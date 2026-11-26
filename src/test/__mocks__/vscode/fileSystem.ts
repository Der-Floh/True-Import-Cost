import { Listeners } from './events';
import { patternMatcher, Uri } from './uri';

import type { Disposable } from './events';
import type { RelativePattern } from './uri';

export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const;

export type FileChange = 'created' | 'changed' | 'deleted';

export interface VirtualFileOptions {
    readonly mtime?: number;
}

interface VirtualFile {
    readonly bytes: Uint8Array;
    readonly mtime: number;
}

const files = new Map<string, VirtualFile>();
const readErrors = new Map<string, Error>();
const heldReads = new Map<string, Promise<void>>();
let reads: string[] = [];
let writes: string[] = [];
let watchers: FakeFileSystemWatcher[] = [];

function fileAt(uri: Uri): VirtualFile | undefined {
    return uri.scheme === 'file' ? files.get(uri.path) : undefined;
}

function isDirectory(uri: Uri): boolean {
    const prefix = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
    return uri.scheme === 'file' && [...files.keys()].some(path => path.startsWith(prefix));
}

function notFound(uri: Uri): Error {
    return new Error(`EntryNotFound (FileSystemError): ${uri.toString()}`);
}

export const fs = {
    stat: (uri: Uri): Promise<{ type: number; ctime: number; mtime: number; size: number }> => {
        const file = fileAt(uri);
        if (file) {
            return Promise.resolve({ type: FileType.File, ctime: file.mtime, mtime: file.mtime, size: file.bytes.byteLength });
        }
        if (isDirectory(uri)) {
            return Promise.resolve({ type: FileType.Directory, ctime: 0, mtime: 0, size: 0 });
        }
        return Promise.reject(notFound(uri));
    },
    readFile: async (uri: Uri): Promise<Uint8Array> => {
        reads.push(uri.path);
        const error = readErrors.get(uri.path);
        const file = fileAt(uri);
        const held = heldReads.get(uri.path);
        if (held) {
            heldReads.delete(uri.path);
            await held;
        }
        if (error) {
            throw error;
        }
        if (!file) {
            throw notFound(uri);
        }
        return file.bytes.slice();
    },
    writeFile: (uri: Uri, content: Uint8Array): Promise<void> => {
        writes.push(uri.path);
        files.set(uri.path, { bytes: content.slice(), mtime: Date.now() });
        return Promise.resolve();
    },
    createDirectory: (_uri: Uri): Promise<void> => Promise.resolve(),
    delete: (uri: Uri, options: { readonly recursive?: boolean } = {}): Promise<void> => {
        const prefix = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
        const nested = [...files.keys()].filter(path => path.startsWith(prefix));
        if (!files.has(uri.path) && (nested.length === 0 || options.recursive !== true)) {
            return Promise.reject(notFound(uri));
        }
        files.delete(uri.path);
        for (const path of nested) {
            files.delete(path);
        }
        return Promise.resolve();
    },
};

class FakeFileSystemWatcher {
    public readonly pattern: RelativePattern | string;
    private readonly matches: (uri: Uri) => boolean;
    private readonly listeners: Readonly<Record<FileChange, Listeners<Uri>>> = {
        created: new Listeners<Uri>(),
        changed: new Listeners<Uri>(),
        deleted: new Listeners<Uri>(),
    };

    public readonly onDidCreate = (listener: (uri: Uri) => unknown): Disposable => this.listeners.created.add(listener);

    public readonly onDidChange = (listener: (uri: Uri) => unknown): Disposable => this.listeners.changed.add(listener);

    public readonly onDidDelete = (listener: (uri: Uri) => unknown): Disposable => this.listeners.deleted.add(listener);

    public constructor(pattern: RelativePattern | string) {
        this.pattern = pattern;
        this.matches = patternMatcher(pattern);
        watchers.push(this);
    }

    public notify(change: FileChange, uri: Uri): void {
        if (this.matches(uri)) {
            this.listeners[change].fire(uri);
        }
    }

    public dispose(): void {
        watchers = watchers.filter(watcher => watcher !== this);
        for (const listeners of Object.values(this.listeners)) {
            listeners.clear();
        }
    }
}

export function createFileSystemWatcher(pattern: RelativePattern | string): FakeFileSystemWatcher {
    return new FakeFileSystemWatcher(pattern);
}

export function virtualFilePaths(): string[] {
    return [...files.keys()].sort();
}

export function setVirtualFile(path: string, content: string | Uint8Array, options: VirtualFileOptions = {}): void {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    files.set(Uri.file(path).path, { bytes, mtime: options.mtime ?? Date.now() });
}

export function removeVirtualFile(path: string): void {
    files.delete(Uri.file(path).path);
}

export function setFileReadError(path: string, error: Error | undefined): void {
    const key = Uri.file(path).path;
    if (error) {
        readErrors.set(key, error);
    } else {
        readErrors.delete(key);
    }
}

export function holdFileRead(path: string): () => void {
    let release = (): void => undefined;
    heldReads.set(Uri.file(path).path, new Promise<void>((resolve) => {
        release = resolve;
    }));
    return () => release();
}

export function fireFileWatcher(change: FileChange, path: string): void {
    const uri = Uri.file(path);
    for (const watcher of [...watchers]) {
        watcher.notify(change, uri);
    }
}

export function flushFileWrites(): string[] {
    return writes.splice(0);
}

export function readVirtualFile(path: string): string | undefined {
    const file = files.get(path);
    return file === undefined ? undefined : new TextDecoder().decode(file.bytes);
}

export function flushFileReads(): string[] {
    return reads.splice(0);
}

export function watcherCount(): number {
    return watchers.length;
}

export function watchedPatterns(): string[] {
    return watchers.map(({ pattern }) => (typeof pattern === 'string' ? pattern : posixJoin(pattern.baseUri.path, pattern.pattern)));
}

function posixJoin(base: string, pattern: string): string {
    return `${base.endsWith('/') ? base : `${base}/`}${pattern}`;
}

export function resetFileSystem(): void {
    writes = [];
    files.clear();
    readErrors.clear();
    heldReads.clear();
    reads = [];
    watchers = [];
}
