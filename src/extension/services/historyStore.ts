import * as vscode from 'vscode';

import { sizeTotals } from '../../core/chunks';
import { appendHistory, historyEntry, parseHistory } from '../../core/history';

import type { ExtensionStorage } from './extensionStorage';
import type { LoadedTarget } from './metadataLoader';
import type { HistoryEntry } from '../../core/history';

const AREA = 'history';

export class HistoryStore implements vscode.Disposable {
    private readonly storage: ExtensionStorage;
    private readonly cache = new Map<string, Promise<readonly HistoryEntry[]>>();
    private readonly queue = new Map<string, Promise<void>>();
    private readonly changed = new vscode.EventEmitter<string>();

    public readonly onDidChange: vscode.Event<string> = this.changed.event;

    public constructor(storage: ExtensionStorage) {
        this.storage = storage;
    }

    public entries(targetKey: string): Promise<readonly HistoryEntry[]> {
        let pending = this.cache.get(targetKey);
        if (!pending) {
            pending = this.storage.readJson(this.storage.fileFor(AREA, targetKey)).then(parseHistory);
            this.cache.set(targetKey, pending);
        }
        return pending;
    }

    public record(target: LoadedTarget): Promise<void> {
        return this.enqueue(target.key, async () => {
            const history = await this.entries(target.key);
            if (history.some(entry => entry.fingerprint === target.fingerprint)) {
                return;
            }
            const entry = historyEntry(target.graph, target.fingerprint, sizeTotals(target.snapshot));
            const updated = appendHistory(history, entry);
            this.cache.set(target.key, Promise.resolve(updated));
            await this.storage.writeJson(this.storage.fileFor(AREA, target.key), updated);
            this.changed.fire(target.key);
        });
    }

    public clear(targetKey: string): Promise<void> {
        return this.enqueue(targetKey, async () => {
            await this.storage.remove(this.storage.fileFor(AREA, targetKey));
            this.cache.set(targetKey, Promise.resolve([]));
            this.changed.fire(targetKey);
        });
    }

    public async clearAll(): Promise<void> {
        await Promise.all([...this.queue.values()]);
        await this.storage.remove(this.storage.areaFor(AREA));
        for (const key of this.cache.keys()) {
            this.cache.set(key, Promise.resolve([]));
            this.changed.fire(key);
        }
    }

    public dispose(): void {
        this.changed.dispose();
    }

    private enqueue(targetKey: string, work: () => Promise<void>): Promise<void> {
        const previous = this.queue.get(targetKey) ?? Promise.resolve();
        const next = previous.then(work, work);
        this.queue.set(targetKey, next.catch(() => undefined));
        return next;
    }
}
