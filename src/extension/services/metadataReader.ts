import { Worker } from 'node:worker_threads';

import { readMetadataFile } from '../../core/metadataFile';

import type { MetadataFileRequest, MetadataFileResult, MetadataWorkerRequest, MetadataWorkerResponse } from '../../core/metadataFile';
import type { BuildSnapshot } from '../../core/schema/snapshot';

export interface MetadataReader {
    read(bytes: Uint8Array, request: MetadataFileRequest): Promise<MetadataFileResult>;
    dispose(): void;
}

export const IN_PROCESS_READER: MetadataReader = {
    read: (bytes, request) => readMetadataFile(bytes, request),
    dispose: () => undefined,
};

export interface WorkerReaderOptions {
    readonly script: string;
    readonly minBytes?: number;
    readonly idleMs?: number;
    readonly onFallback?: (reason: string) => void;
}

interface PendingRead {
    readonly bytes: Uint8Array;
    readonly request: MetadataFileRequest;
    readonly resolve: (result: MetadataFileResult) => void;
}

const MIN_BYTES = 512 * 1024;

const IDLE_MS = 60_000;

const STOPPED: MetadataFileResult = { ok: false, error: 'True Import Cost stopped before the file was read' };

function resultOf(response: MetadataWorkerResponse): MetadataFileResult {
    if (!response.ok) {
        return { ok: false, error: response.error };
    }
    return {
        ok: true,
        snapshot: JSON.parse(response.snapshot) as BuildSnapshot,
        adapter: response.adapter,
        fingerprint: response.fingerprint,
        precomputed: response.precomputed,
    };
}

export class WorkerMetadataReader implements MetadataReader {
    private readonly script: string;
    private readonly minBytes: number;
    private readonly idleMs: number;
    private readonly onFallback: (reason: string) => void;
    private readonly pending = new Map<number, PendingRead>();
    private worker: Worker | undefined;
    private idleTimer: ReturnType<typeof setTimeout> | undefined;
    private nextId = 0;
    private broken = false;
    private disposed = false;

    public constructor(options: WorkerReaderOptions) {
        this.script = options.script;
        this.minBytes = options.minBytes ?? MIN_BYTES;
        this.idleMs = options.idleMs ?? IDLE_MS;
        this.onFallback = options.onFallback ?? (() => undefined);
    }

    public get running(): boolean {
        return this.worker !== undefined;
    }

    public read(bytes: Uint8Array, request: MetadataFileRequest): Promise<MetadataFileResult> {
        if (this.disposed) {
            return Promise.resolve(STOPPED);
        }
        const worker = bytes.byteLength < this.minBytes ? undefined : this.start();
        if (!worker) {
            return readMetadataFile(bytes, request);
        }
        const id = ++this.nextId;
        const copy = bytes.slice();
        return new Promise((resolve) => {
            this.pending.set(id, { bytes, request, resolve });
            this.stopIdleTimer();
            const message: MetadataWorkerRequest = { id, bytes: copy, request };
            try {
                worker.ref();
                worker.postMessage(message, [copy.buffer]);
            } catch (error: unknown) {
                this.crash(worker, error);
            }
        });
    }

    public dispose(): void {
        this.disposed = true;
        this.stopIdleTimer();
        const worker = this.worker;
        this.worker = undefined;
        void worker?.terminate();
        for (const read of this.pending.values()) {
            read.resolve(STOPPED);
        }
        this.pending.clear();
    }

    private start(): Worker | undefined {
        if (this.worker || this.broken) {
            return this.worker;
        }
        let worker: Worker;
        try {
            worker = new Worker(this.script);
        } catch (error: unknown) {
            this.fail(error);
            return undefined;
        }
        worker.on('message', (response: MetadataWorkerResponse) => this.settle(worker, response));
        worker.on('error', error => this.crash(worker, error));
        worker.on('exit', code => this.crash(worker, new Error(`the worker exited with code ${code}`)));
        this.worker = worker;
        return worker;
    }

    private settle(worker: Worker, response: MetadataWorkerResponse): void {
        const read = this.pending.get(response.id);
        if (!read) {
            return;
        }
        this.pending.delete(response.id);
        try {
            read.resolve(resultOf(response));
        } catch (error: unknown) {
            read.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        if (this.pending.size === 0 && this.worker === worker) {
            worker.unref();
            this.startIdleTimer(worker);
        }
    }

    private crash(worker: Worker, error: unknown): void {
        if (this.worker !== worker) {
            return;
        }
        this.worker = undefined;
        this.stopIdleTimer();
        void worker.terminate();
        this.fail(error);
        const reads = [...this.pending.values()];
        this.pending.clear();
        for (const read of reads) {
            void readMetadataFile(read.bytes, read.request).then(read.resolve);
        }
    }

    private fail(error: unknown): void {
        this.broken = true;
        this.onFallback(error instanceof Error ? error.message : String(error));
    }

    private startIdleTimer(worker: Worker): void {
        this.stopIdleTimer();
        this.idleTimer = setTimeout(() => {
            this.idleTimer = undefined;
            if (this.worker === worker && this.pending.size === 0) {
                this.worker = undefined;
                void worker.terminate();
            }
        }, this.idleMs);
        this.idleTimer.unref();
    }

    private stopIdleTimer(): void {
        if (this.idleTimer !== undefined) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
    }
}
