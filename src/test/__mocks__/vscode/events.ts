export class Disposable {
    private callOnDispose: (() => unknown) | undefined;

    public constructor(callOnDispose: () => unknown) {
        this.callOnDispose = callOnDispose;
    }

    public dispose(): void {
        const callOnDispose = this.callOnDispose;
        this.callOnDispose = undefined;
        callOnDispose?.();
    }
}

export class Listeners<T> {
    private listeners: ((value: T) => unknown)[] = [];

    public get count(): number {
        return this.listeners.length;
    }

    public add(listener: (value: T) => unknown): Disposable {
        this.listeners.push(listener);
        return new Disposable(() => {
            const index = this.listeners.indexOf(listener);
            if (index >= 0) {
                this.listeners.splice(index, 1);
            }
        });
    }

    public fire(value: T): void {
        for (const listener of [...this.listeners]) {
            if (this.listeners.includes(listener)) {
                listener(value);
            }
        }
    }

    public clear(): void {
        this.listeners = [];
    }
}

const emitters = new Set<{ readonly listenerCount: number }>();

const hostEvents: { readonly name: string; readonly listeners: { readonly count: number; clear(): void } }[] = [];

export class EventEmitter<T> {
    private readonly listeners = new Listeners<T>();
    private disposed = false;

    public readonly event = (listener: (value: T) => unknown): Disposable =>
        (this.disposed ? new Disposable(() => undefined) : this.listeners.add(listener));

    public constructor() {
        emitters.add(this);
    }

    public get listenerCount(): number {
        return this.listeners.count;
    }

    public fire(value: T): void {
        this.listeners.fire(value);
    }

    public dispose(): void {
        this.disposed = true;
        this.listeners.clear();
    }
}

export function hostEvent<T>(name: string): Listeners<T> {
    const listeners = new Listeners<T>();
    hostEvents.push({ name, listeners });
    return listeners;
}

class CancellationToken {
    private cancelled = false;
    private readonly listeners = new Listeners<undefined>();

    public readonly onCancellationRequested = (listener: () => unknown): Disposable => {
        if (this.cancelled) {
            const timer = setTimeout(listener, 0);
            return new Disposable(() => clearTimeout(timer));
        }
        return this.listeners.add(listener);
    };

    public get isCancellationRequested(): boolean {
        return this.cancelled;
    }

    public cancel(): void {
        if (this.cancelled) {
            return;
        }
        this.cancelled = true;
        this.listeners.fire(undefined);
        this.listeners.clear();
    }

    public release(): void {
        this.listeners.clear();
    }
}

export class CancellationTokenSource {
    public readonly token = new CancellationToken();

    public cancel(): void {
        this.token.cancel();
    }

    public dispose(): void {
        this.token.release();
    }
}

export function emitterListenerCount(): number {
    let count = 0;
    for (const emitter of emitters) {
        count += emitter.listenerCount;
    }
    return count;
}

export function hostListenerCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const { name, listeners } of hostEvents) {
        if (listeners.count > 0) {
            counts[name] = listeners.count;
        }
    }
    return counts;
}

export function resetEvents(): void {
    emitters.clear();
    for (const { listeners } of hostEvents) {
        listeners.clear();
    }
}
