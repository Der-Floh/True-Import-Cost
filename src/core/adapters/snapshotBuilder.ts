import { packageFromPath } from '../packages';
import { PRECISION_RANK, SNAPSHOT_FORMAT, SNAPSHOT_SCHEMA_VERSION } from '../schema/snapshot';

import type { BuildContext } from './adapter';
import type {
    AssetRecord,
    BuildSnapshot,
    ChunkRecord,
    ImportEdge,
    MeasurementPrecision,
    ModuleContribution,
    ModuleRecord,
} from '../schema/snapshot';

interface ModuleDraft {
    id: string;
    path: string;
    virtual: boolean;
    entry: boolean;
    sourceBytes?: number;
    packageName?: string;
    packageVersion?: string;
    packageRoot?: string;
    contributions: Map<string, ModuleContribution>;
}

export interface ModuleOptions {
    readonly virtual?: boolean;
    readonly sourceBytes?: number;
}

export class SnapshotBuilder {
    private readonly modules = new Map<string, ModuleDraft>();
    private readonly chunks = new Map<string, ChunkRecord>();
    private readonly assets = new Map<string, AssetRecord>();
    private readonly imports: ImportEdge[] = [];
    private readonly edgeKeys = new Set<string>();
    private readonly entryCandidates = new Set<string>();

    public hasModule(id: string): boolean {
        return this.modules.has(id);
    }

    public module(id: string, path: string, options: ModuleOptions = {}): void {
        const existing = this.modules.get(id);
        if (existing) {
            if (options.sourceBytes !== undefined) {
                existing.sourceBytes = options.sourceBytes;
            }
            return;
        }
        const draft: ModuleDraft = {
            id,
            path,
            virtual: options.virtual ?? false,
            entry: false,
            contributions: new Map(),
        };
        if (options.sourceBytes !== undefined) {
            draft.sourceBytes = options.sourceBytes;
        }
        const identity = packageFromPath(path);
        if (identity) {
            draft.packageName = identity.name;
            draft.packageRoot = identity.root;
            if (identity.version !== undefined) {
                draft.packageVersion = identity.version;
            }
        }
        this.modules.set(id, draft);
    }

    public contribute(moduleId: string, chunkId: string, bytes: number, precision: MeasurementPrecision): void {
        const draft = this.modules.get(moduleId);
        if (!draft || bytes <= 0) {
            return;
        }
        const previous = draft.contributions.get(chunkId);
        draft.contributions.set(chunkId, {
            chunkId,
            bytes: Math.round((previous?.bytes ?? 0) + bytes),
            precision: previous && PRECISION_RANK[previous.precision] > PRECISION_RANK[precision] ? previous.precision : precision,
        });
    }

    public edge(edge: ImportEdge): void {
        const key = `${edge.importer}\u0001${edge.resolvedModule ?? ''}\u0001${edge.specifier ?? ''}\u0001${edge.kind}\u0001${edge.external ? 1 : 0}`;
        if (this.edgeKeys.has(key)) {
            return;
        }
        this.edgeKeys.add(key);
        this.imports.push(edge);
    }

    public chunk(chunk: ChunkRecord): void {
        this.chunks.set(chunk.id, chunk);
    }

    public hasOutput(id: string): boolean {
        return this.chunks.has(id) || this.assets.has(id);
    }

    public asset(asset: AssetRecord): void {
        this.assets.set(asset.id, asset);
    }

    public markEntry(moduleId: string): void {
        const draft = this.modules.get(moduleId);
        if (draft) {
            draft.entry = true;
        }
    }

    public markEntryCandidate(moduleId: string): void {
        this.entryCandidates.add(moduleId);
    }

    public isEntry(moduleId: string): boolean {
        return this.modules.get(moduleId)?.entry ?? false;
    }

    public resolveEntryCandidates(): void {
        if (this.entryCandidates.size === 0) {
            return;
        }
        const loadedLazily = new Set(this.imports.flatMap(edge => (edge.kind === 'dynamic' && edge.resolvedModule !== undefined ? [edge.resolvedModule] : [])));
        const roots = [...this.entryCandidates].filter(id => !loadedLazily.has(id));
        for (const id of roots.length > 0 ? roots : this.entryCandidates) {
            this.markEntry(id);
        }
    }

    public build(context: BuildContext): BuildSnapshot {
        const modules: ModuleRecord[] = [...this.modules.values()].map(draft => toRecord(draft));
        const snapshot: BuildSnapshot = {
            format: SNAPSHOT_FORMAT,
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            id: context.id ?? `${context.target}@${context.createdAt}`,
            target: context.target,
            createdAt: context.createdAt,
            bundler: context.bundler ?? { name: 'unknown' },
            root: context.root ?? '.',
            modules,
            chunks: [...this.chunks.values()],
            assets: [...this.assets.values()],
            imports: this.imports,
        };
        return context.mode === undefined ? snapshot : { ...snapshot, mode: context.mode };
    }
}

function toRecord(draft: ModuleDraft): ModuleRecord {
    return {
        id: draft.id,
        path: draft.path,
        ...(draft.virtual ? { virtual: true } : {}),
        ...(draft.entry ? { entry: true } : {}),
        ...(draft.packageName === undefined ? {} : { packageName: draft.packageName }),
        ...(draft.packageVersion === undefined ? {} : { packageVersion: draft.packageVersion }),
        ...(draft.packageRoot === undefined ? {} : { packageRoot: draft.packageRoot }),
        ...(draft.sourceBytes === undefined ? {} : { sourceBytes: draft.sourceBytes }),
        contributions: [...draft.contributions.values()],
    };
}
