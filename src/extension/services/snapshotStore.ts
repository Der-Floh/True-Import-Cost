import * as vscode from 'vscode';

import { Logger } from './logger';
import { loadTarget } from './metadataLoader';
import { locateMetadata } from './metadataLocator';
import { IN_PROCESS_READER } from './metadataReader';
import { readFolderSettings } from './settings';
import { DISCOVERY_GLOB } from '../constants';
import { relativePath } from '../../core/paths';

import type { LoadedTarget } from './metadataLoader';
import type { MetadataSource } from './metadataLocator';
import type { MetadataReader } from './metadataReader';

export interface TargetFailure {
    readonly key: string;
    readonly source: MetadataSource;
    readonly error: string;
}

const RELOAD_DELAY_MS = 250;

const GLOB_SYNTAX = /[*?[\]{}]/;

export function documentPathIn(baseUri: vscode.Uri, documentUri: vscode.Uri): string | undefined {
    if (baseUri.scheme !== documentUri.scheme || baseUri.authority !== documentUri.authority) {
        return undefined;
    }
    return relativePath(baseUri.path, documentUri.path);
}

export class SnapshotStore implements vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    private readonly loaded = new Map<string, LoadedTarget>();
    private readonly failed = new Map<string, TargetFailure>();
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly reads = new Map<string, number>();
    private sources = new Map<string, MetadataSource>();
    private watchers: vscode.Disposable[] = [];
    private generation = 0;
    private readonly isEnabled: () => boolean;
    private disposed = false;

    public readonly onDidChange: vscode.Event<void> = this.changed.event;
    public readonly reader: MetadataReader;

    public constructor(isEnabled: () => boolean, reader: MetadataReader = IN_PROCESS_READER) {
        this.isEnabled = isEnabled;
        this.reader = reader;
    }

    public targets(): readonly LoadedTarget[] {
        return [...this.loaded.values()].sort((a, b) => a.id.localeCompare(b.id) || a.key.localeCompare(b.key));
    }

    public target(key: string): LoadedTarget | undefined {
        return this.loaded.get(key);
    }

    public failures(): readonly TargetFailure[] {
        return [...this.failed.values()];
    }

    public failureFor(key: string): TargetFailure | undefined {
        return this.failed.get(key);
    }

    public targetsContaining(documentUri: vscode.Uri): LoadedTarget[] {
        return this.targets().filter((target) => {
            const path = documentPathIn(target.baseUri, documentUri);
            return path !== undefined && target.graph.modulesAt(path).length > 0;
        });
    }

    public async refresh(): Promise<void> {
        const generation = ++this.generation;
        const sources = await locateMetadata(vscode.workspace.workspaceFolders ?? [], this.isEnabled());
        if (generation !== this.generation || this.disposed) {
            return;
        }
        this.sources = new Map(sources.map(source => [source.uri.toString(), source]));
        for (const key of [...this.loaded.keys()]) {
            if (!this.sources.has(key)) {
                this.loaded.delete(key);
            }
        }
        for (const key of [...this.failed.keys()]) {
            if (!this.sources.has(key)) {
                this.failed.delete(key);
            }
        }
        this.watch();
        await Promise.all(sources.map(source => this.load(source)));
        if (generation === this.generation && !this.disposed) {
            Logger.info(`Loaded ${this.loaded.size} build target(s), ${this.failed.size} failed.`);
            this.changed.fire();
        }
    }

    public clear(): void {
        this.loaded.clear();
        this.failed.clear();
        this.changed.fire();
    }

    public dispose(): void {
        this.disposed = true;
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.unwatch();
        this.changed.dispose();
    }

    private async load(source: MetadataSource): Promise<void> {
        const key = source.uri.toString();
        const read = (this.reads.get(key) ?? 0) + 1;
        this.reads.set(key, read);
        const result = await loadTarget(source, this.reader);
        if (this.disposed || !this.sources.has(key) || this.reads.get(key) !== read) {
            return;
        }
        if (result.ok) {
            this.loaded.set(key, result.target);
            this.failed.delete(key);
            Logger.debug(`Read ${result.target.adapter} metadata for target "${result.target.id}" from ${source.uri.toString()}.`);
            return;
        }
        this.failed.set(key, { key, source, error: result.error });
        Logger.warn(`Could not read build metadata ${source.uri.toString()}: ${result.error}`);
    }

    private schedule(uri: vscode.Uri): void {
        const key = uri.toString();
        const previous = this.timers.get(key);
        if (previous !== undefined) {
            clearTimeout(previous);
        }
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            const source = this.sources.get(key);
            if (!source) {
                void this.refresh();
                return;
            }
            void this.load(source).then(() => {
                if (!this.disposed) {
                    this.changed.fire();
                }
            });
        }, RELOAD_DELAY_MS));
    }

    private forget(uri: vscode.Uri): void {
        const key = uri.toString();
        const source = this.sources.get(key);
        if (source?.setting) {
            this.loaded.delete(key);
            this.failed.set(key, { key, source, error: 'the file was deleted' });
        } else {
            this.sources.delete(key);
            this.loaded.delete(key);
            this.failed.delete(key);
        }
        this.changed.fire();
    }

    private unwatch(): void {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
    }

    private watch(): void {
        this.unwatch();
        if (!this.isEnabled()) {
            return;
        }
        const watched: { readonly pattern: vscode.RelativePattern; readonly only?: string }[] = [];
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            if (readFolderSettings(folder).autoDiscover) {
                watched.push({ pattern: new vscode.RelativePattern(folder, DISCOVERY_GLOB) });
            }
        }
        for (const source of this.sources.values()) {
            if (source.setting) {
                const name = source.uri.path.slice(source.uri.path.lastIndexOf('/') + 1);
                const literal = !GLOB_SYNTAX.test(name);
                watched.push({
                    pattern: new vscode.RelativePattern(vscode.Uri.joinPath(source.uri, '..'), literal ? name : '*'),
                    ...(literal ? {} : { only: source.uri.toString() }),
                });
            }
        }
        for (const { pattern, only } of watched) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            const wanted = (uri: vscode.Uri): boolean => only === undefined || uri.toString() === only;
            this.watchers.push(
                watcher,
                watcher.onDidCreate(uri => wanted(uri) && this.schedule(uri)),
                watcher.onDidChange(uri => wanted(uri) && this.schedule(uri)),
                watcher.onDidDelete(uri => wanted(uri) && this.forget(uri)),
            );
        }
    }
}
