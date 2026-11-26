import { PRECISION_RANK } from '../schema/snapshot';

import type { BuildSnapshot, ImportEdge, MeasurementPrecision, ModuleRecord } from '../schema/snapshot';

export interface PackageInstance {
    readonly key: string;
    readonly name: string;
    readonly version?: string;
    readonly root: string;
    readonly moduleIds: readonly string[];
    readonly bytes: number;
}

const EMPTY: readonly ImportEdge[] = [];

export class BuildGraph {
    public readonly snapshot: BuildSnapshot;
    public readonly entries: readonly string[];

    private readonly modulesById = new Map<string, ModuleRecord>();
    private readonly modulesByPath = new Map<string, ModuleRecord[]>();
    private readonly outgoing = new Map<string, ImportEdge[]>();
    private readonly incoming = new Map<string, ImportEdge[]>();
    private readonly bytesById = new Map<string, number>();
    private readonly precisionById = new Map<string, MeasurementPrecision>();
    private packageCache: ReadonlyMap<string, PackageInstance> | undefined;

    public constructor(snapshot: BuildSnapshot) {
        this.snapshot = snapshot;
        for (const module of snapshot.modules) {
            this.modulesById.set(module.id, module);
            const atPath = this.modulesByPath.get(module.path);
            if (atPath) {
                atPath.push(module);
            } else {
                this.modulesByPath.set(module.path, [module]);
            }
            let bytes = 0;
            let precision: MeasurementPrecision | undefined;
            for (const contribution of module.contributions) {
                bytes += contribution.bytes;
                if (precision === undefined || PRECISION_RANK[contribution.precision] > PRECISION_RANK[precision]) {
                    precision = contribution.precision;
                }
            }
            this.bytesById.set(module.id, bytes);
            if (precision !== undefined) {
                this.precisionById.set(module.id, precision);
            }
        }
        for (const edge of snapshot.imports) {
            push(this.outgoing, edge.importer, edge);
            if (edge.resolvedModule !== undefined) {
                push(this.incoming, edge.resolvedModule, edge);
            }
        }
        this.entries = this.findEntries();
    }

    public module(id: string): ModuleRecord | undefined {
        return this.modulesById.get(id);
    }

    public modulesAt(path: string): readonly ModuleRecord[] {
        return this.modulesByPath.get(path) ?? [];
    }

    public importsOf(id: string): readonly ImportEdge[] {
        return this.outgoing.get(id) ?? EMPTY;
    }

    public importersOf(id: string): readonly ImportEdge[] {
        return this.incoming.get(id) ?? EMPTY;
    }

    public bytesOf(id: string): number {
        return this.bytesById.get(id) ?? 0;
    }

    public precisionOf(id: string): MeasurementPrecision | undefined {
        return this.precisionById.get(id);
    }

    public get moduleCount(): number {
        return this.modulesById.size;
    }

    public modules(): IterableIterator<ModuleRecord> {
        return this.modulesById.values();
    }

    public packages(): ReadonlyMap<string, PackageInstance> {
        if (this.packageCache) {
            return this.packageCache;
        }
        const drafts = new Map<string, { name: string; version?: string; root: string; moduleIds: string[]; bytes: number }>();
        for (const module of this.modulesById.values()) {
            if (module.packageName === undefined || module.packageRoot === undefined) {
                continue;
            }
            const key = module.packageRoot;
            let draft = drafts.get(key);
            if (!draft) {
                draft = { name: module.packageName, root: module.packageRoot, moduleIds: [], bytes: 0 };
                if (module.packageVersion !== undefined) {
                    draft.version = module.packageVersion;
                }
                drafts.set(key, draft);
            }
            draft.moduleIds.push(module.id);
            draft.bytes += this.bytesOf(module.id);
        }
        const instances = new Map<string, PackageInstance>();
        for (const [key, draft] of drafts) {
            instances.set(key, { key, ...draft });
        }
        this.packageCache = instances;
        return instances;
    }

    public packageOf(moduleId: string): PackageInstance | undefined {
        const root = this.modulesById.get(moduleId)?.packageRoot;
        return root === undefined ? undefined : this.packages().get(root);
    }

    private findEntries(): string[] {
        const declared = this.snapshot.modules.filter(module => module.entry === true).map(module => module.id);
        if (declared.length > 0) {
            return declared;
        }
        const fromChunks = this.snapshot.chunks
            .filter(chunk => chunk.entry && chunk.entryModule !== undefined)
            .map(chunk => chunk.entryModule as string);
        if (fromChunks.length > 0) {
            return [...new Set(fromChunks)];
        }
        return this.snapshot.modules
            .filter(module => this.importersOf(module.id).length === 0 && this.importsOf(module.id).length > 0)
            .map(module => module.id);
    }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const list = map.get(key);
    if (list) {
        list.push(value);
    } else {
        map.set(key, [value]);
    }
}
