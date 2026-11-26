import * as vscode from 'vscode';

import { parseMeasurement } from '../../core/measurement';

import type { ExtensionStorage } from './extensionStorage';
import type { ImportMeasurement } from '../../core/measurement';

const AREA = 'measurements';

export const MAX_MEASUREMENTS = 500;

function keyOf(importer: string, specifier: string): string {
    return `${importer}\u0001${specifier}`;
}

function parseMeasurements(value: unknown): ImportMeasurement[] {
    const list = typeof value === 'object' && value !== null ? (value as { measurements?: unknown }).measurements : undefined;
    if (!Array.isArray(list)) {
        return [];
    }
    return list.slice(-MAX_MEASUREMENTS).map(parseMeasurement).filter((measurement): measurement is ImportMeasurement => measurement !== undefined);
}

export class MeasurementStore implements vscode.Disposable {
    private readonly storage: ExtensionStorage;
    private readonly cache = new Map<string, Promise<readonly ImportMeasurement[]>>();
    private readonly queue = new Map<string, Promise<void>>();
    private readonly changed = new vscode.EventEmitter<string>();

    public readonly onDidChange: vscode.Event<string> = this.changed.event;

    public constructor(storage: ExtensionStorage) {
        this.storage = storage;
    }

    public all(targetKey: string): Promise<readonly ImportMeasurement[]> {
        let pending = this.cache.get(targetKey);
        if (!pending) {
            pending = this.storage.readJson(this.storage.fileFor(AREA, targetKey)).then(parseMeasurements);
            this.cache.set(targetKey, pending);
        }
        return pending;
    }

    public async find(targetKey: string, importer: string, specifier: string): Promise<ImportMeasurement | undefined> {
        const key = keyOf(importer, specifier);
        return (await this.all(targetKey)).find(measurement => keyOf(measurement.importer, measurement.specifier) === key);
    }

    public record(targetKey: string, measurement: ImportMeasurement): Promise<void> {
        return this.enqueue(targetKey, async () => {
            const key = keyOf(measurement.importer, measurement.specifier);
            const kept = (await this.all(targetKey)).filter(existing => keyOf(existing.importer, existing.specifier) !== key);
            const updated = [...kept, measurement].slice(-MAX_MEASUREMENTS);
            this.cache.set(targetKey, Promise.resolve(updated));
            await this.storage.writeJson(this.storage.fileFor(AREA, targetKey), { version: 1, measurements: updated });
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
