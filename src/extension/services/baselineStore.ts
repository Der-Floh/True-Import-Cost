import * as vscode from 'vscode';

import { Logger } from './logger';
import { BuildGraph } from '../../core/graph/buildGraph';
import { parseSnapshot } from '../../core/schema/validate';

import type { ExtensionStorage } from './extensionStorage';
import type { LoadedTarget } from './metadataLoader';
import type { BuildSnapshot } from '../../core/schema/snapshot';

export type BaselineSource = 'pinned' | 'file';

export interface Baseline {
    readonly source: BaselineSource;
    readonly label: string;
    readonly savedAt: number;
    readonly graph: BuildGraph;
}

interface StoredBaseline {
    readonly version: 1;
    readonly source: BaselineSource;
    readonly label: string;
    readonly savedAt: number;
    readonly snapshot: BuildSnapshot;
}

const AREA = 'baselines';

function readStored(value: unknown): Baseline | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const record = value as Partial<Record<keyof StoredBaseline, unknown>>;
    if (record.version !== 1 || (record.source !== 'pinned' && record.source !== 'file') || typeof record.label !== 'string' || typeof record.savedAt !== 'number') {
        return undefined;
    }
    const parsed = parseSnapshot(record.snapshot);
    if (!parsed.ok) {
        Logger.warn(`Ignored a stored baseline that is no longer valid: ${parsed.error}`);
        return undefined;
    }
    return { source: record.source, label: record.label, savedAt: record.savedAt, graph: new BuildGraph(parsed.snapshot) };
}

export class BaselineStore implements vscode.Disposable {
    private readonly storage: ExtensionStorage;
    private readonly cache = new Map<string, Promise<Baseline | undefined>>();
    private readonly resolved = new Map<string, Baseline | undefined>();
    private readonly changed = new vscode.EventEmitter<string>();

    public readonly onDidChange: vscode.Event<string> = this.changed.event;

    public constructor(storage: ExtensionStorage) {
        this.storage = storage;
    }

    public get(targetKey: string): Promise<Baseline | undefined> {
        let pending = this.cache.get(targetKey);
        if (!pending) {
            pending = this.storage.readJson(this.storage.fileFor(AREA, targetKey)).then((value) => {
                const baseline = readStored(value);
                if (this.cache.get(targetKey) === pending) {
                    this.resolved.set(targetKey, baseline);
                    if (baseline !== undefined) {
                        this.changed.fire(targetKey);
                    }
                }
                return baseline;
            });
            this.cache.set(targetKey, pending);
        }
        return pending;
    }

    public peek(targetKey: string): Baseline | undefined {
        if (!this.cache.has(targetKey)) {
            void this.get(targetKey);
        }
        return this.resolved.get(targetKey);
    }

    public pin(target: LoadedTarget): Promise<void> {
        return this.save(target.key, 'pinned', 'Pinned build', target.snapshot);
    }

    public useSnapshot(targetKey: string, snapshot: BuildSnapshot, label: string): Promise<void> {
        return this.save(targetKey, 'file', label, snapshot);
    }

    public async clear(targetKey: string): Promise<void> {
        await this.storage.remove(this.storage.fileFor(AREA, targetKey));
        this.cache.set(targetKey, Promise.resolve(undefined));
        this.resolved.set(targetKey, undefined);
        this.changed.fire(targetKey);
    }

    public dispose(): void {
        this.changed.dispose();
    }

    private async save(targetKey: string, source: BaselineSource, label: string, snapshot: BuildSnapshot): Promise<void> {
        const stored: StoredBaseline = { version: 1, source, label, savedAt: Date.now(), snapshot };
        await this.storage.writeJson(this.storage.fileFor(AREA, targetKey), stored);
        const baseline: Baseline = { source, label, savedAt: stored.savedAt, graph: new BuildGraph(snapshot) };
        this.cache.set(targetKey, Promise.resolve(baseline));
        this.resolved.set(targetKey, baseline);
        this.changed.fire(targetKey);
    }
}
