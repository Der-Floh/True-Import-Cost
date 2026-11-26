import { BuildGraph } from '../../../core/graph/buildGraph';
import { SNAPSHOT_FORMAT, SNAPSHOT_SCHEMA_VERSION } from '../../../core/schema/snapshot';

import type {
    AssetRecord,
    BuildSnapshot,
    ChunkRecord,
    ImportEdge,
    ImportKind,
    MeasurementPrecision,
    ModuleContribution,
    ModuleRecord,
} from '../../../core/schema/snapshot';

export const MAIN_CHUNK = 'dist/main.js';

export interface PackageSpec {
    readonly packageName: string;
    readonly packageRoot: string;
    readonly packageVersion?: string;
}

export interface ModuleSpec extends Partial<PackageSpec> {
    readonly path?: string;
    readonly entry?: boolean;
    readonly chunk?: string;
    readonly precision?: MeasurementPrecision;
    readonly contributions?: readonly ModuleContribution[];
}

export interface EdgeSpec {
    readonly kind?: ImportKind;
    readonly specifier?: string;
}

export interface ExternalSpec {
    readonly kind?: ImportKind;
    readonly retained?: boolean;
}

export type ChunkSpec = Partial<ChunkRecord> & Pick<ChunkRecord, 'id' | 'bytes'>;

export function inPackage(packageName: string, packageVersion?: string, packageRoot = `node_modules/${packageName}`): PackageSpec {
    return packageVersion === undefined ? { packageName, packageRoot } : { packageName, packageRoot, packageVersion };
}

export function chunkRecord(spec: ChunkSpec): ChunkRecord {
    return {
        kind: spec.id.endsWith('.css') ? 'css' : 'js',
        entry: false,
        dynamicEntry: false,
        imports: [],
        dynamicImports: [],
        css: [],
        assets: [],
        ...spec,
    };
}

export class SnapshotFixture {
    private readonly modules = new Map<string, ModuleRecord>();
    private readonly edges: ImportEdge[] = [];
    private readonly chunks = new Map<string, ChunkRecord>();
    private readonly assets: AssetRecord[] = [];

    public module(id: string, bytes = 0, spec: ModuleSpec = {}): this {
        const contributions = spec.contributions
            ?? (bytes > 0 ? [{ chunkId: spec.chunk ?? MAIN_CHUNK, bytes, precision: spec.precision ?? 'bundler-reported' }] : []);
        this.modules.set(id, {
            id,
            path: spec.path ?? id,
            ...(spec.entry === undefined ? {} : { entry: spec.entry }),
            ...(spec.packageName === undefined ? {} : { packageName: spec.packageName }),
            ...(spec.packageVersion === undefined ? {} : { packageVersion: spec.packageVersion }),
            ...(spec.packageRoot === undefined ? {} : { packageRoot: spec.packageRoot }),
            contributions,
        });
        return this;
    }

    public imports(importer: string, resolvedModule: string, spec: EdgeSpec = {}): this {
        this.edges.push({
            importer,
            ...(spec.specifier === undefined ? {} : { specifier: spec.specifier }),
            resolvedModule,
            kind: spec.kind ?? 'static',
            external: false,
        });
        return this;
    }

    public external(importer: string, specifier: string, spec: ExternalSpec = {}): this {
        this.edges.push({
            importer,
            specifier,
            kind: spec.kind ?? 'static',
            external: true,
            ...(spec.retained === undefined ? {} : { retained: spec.retained }),
        });
        return this;
    }

    public chunk(spec: ChunkSpec): this {
        this.chunks.set(spec.id, chunkRecord(spec));
        return this;
    }

    public asset(asset: AssetRecord): this {
        this.assets.push(asset);
        return this;
    }

    public snapshot(): BuildSnapshot {
        const declared = new Set([...this.chunks.keys(), ...this.assets.map(asset => asset.id)]);
        const implicit = new Map<string, number>();
        for (const module of this.modules.values()) {
            for (const contribution of module.contributions) {
                if (!declared.has(contribution.chunkId)) {
                    implicit.set(contribution.chunkId, (implicit.get(contribution.chunkId) ?? 0) + contribution.bytes);
                }
            }
        }
        return {
            format: SNAPSHOT_FORMAT,
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            id: 'fixture@0',
            target: 'fixture',
            createdAt: 0,
            bundler: { name: 'fixture' },
            root: '.',
            modules: [...this.modules.values()],
            chunks: [...this.chunks.values(), ...[...implicit].map(([id, bytes]) => chunkRecord({ id, bytes }))],
            assets: [...this.assets],
            imports: [...this.edges],
        };
    }

    public graph(): BuildGraph {
        return new BuildGraph(this.snapshot());
    }
}

export function fixture(): SnapshotFixture {
    return new SnapshotFixture();
}

export function moduleIn(snapshot: BuildSnapshot, id: string): ModuleRecord {
    const found = snapshot.modules.find(module => module.id === id);
    if (!found) {
        throw new Error(`the snapshot has no module "${id}"; it has ${snapshot.modules.map(module => `"${module.id}"`).join(', ')}`);
    }
    return found;
}

export function chunkIn(snapshot: BuildSnapshot, id: string): ChunkRecord {
    const found = snapshot.chunks.find(chunk => chunk.id === id);
    if (!found) {
        throw new Error(`the snapshot has no chunk "${id}"; it has ${snapshot.chunks.map(chunk => `"${chunk.id}"`).join(', ')}`);
    }
    return found;
}

export function edgesFrom(snapshot: BuildSnapshot, importer: string): ImportEdge[] {
    return snapshot.imports.filter(edge => edge.importer === importer);
}

export function bytesIn(snapshot: BuildSnapshot, moduleId: string): Record<string, number> {
    return Object.fromEntries(moduleIn(snapshot, moduleId).contributions.map(contribution => [contribution.chunkId, contribution.bytes]));
}
