import type { BuildSnapshot, BundlerInfo, ImportEdge, ImportKind, MeasurementPrecision, ModuleRecord } from '../../../core/schema/snapshot';

export interface SnapshotModule {
    readonly path: string;
    readonly bytes?: number;
    readonly precision?: MeasurementPrecision;
    readonly entry?: boolean;
    readonly virtual?: boolean;
    readonly packageVersion?: string;
}

export interface SnapshotSpec {
    readonly target: string;
    readonly root?: string;
    readonly createdAt?: number;
    readonly bundler?: BundlerInfo;
    readonly mode?: 'production' | 'development';
    readonly chunk?: string;
    readonly modules: readonly SnapshotModule[];
    readonly imports?: readonly ImportEdge[];
}

export function edge(importer: string, specifier: string, resolvedModule: string, kind: ImportKind = 'static'): ImportEdge {
    return { importer, specifier, resolvedModule, kind, external: false };
}

export function externalEdge(importer: string, specifier: string, retained = true): ImportEdge {
    return { importer, specifier, kind: 'static', external: true, retained };
}

function packageOf(path: string): Pick<ModuleRecord, 'packageName' | 'packageRoot'> {
    const match = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(path);
    return match ? { packageName: match[2], packageRoot: match[1] } : {};
}

export function buildSnapshot(spec: SnapshotSpec): BuildSnapshot {
    const chunk = spec.chunk ?? 'assets/index.js';
    const createdAt = spec.createdAt ?? Date.now();
    const modules = spec.modules.map((module): ModuleRecord => ({
        id: module.path,
        path: module.path,
        ...(module.virtual === true ? { virtual: true } : {}),
        ...(module.entry === true ? { entry: true } : {}),
        ...(module.virtual === true ? {} : packageOf(module.path)),
        ...(module.packageVersion === undefined ? {} : { packageVersion: module.packageVersion }),
        contributions: (module.bytes ?? 0) > 0 ? [{ chunkId: chunk, bytes: module.bytes ?? 0, precision: module.precision ?? 'bundler-reported' }] : [],
    }));
    const entryModule = spec.modules.find(module => module.entry === true)?.path;
    return {
        format: 'true-import-cost/build-snapshot',
        schemaVersion: 1,
        id: `${spec.target}@${createdAt}`,
        target: spec.target,
        createdAt,
        bundler: spec.bundler ?? { name: 'vite', version: '8.3.8', engine: 'rolldown' },
        ...(spec.mode === undefined ? {} : { mode: spec.mode }),
        root: spec.root ?? '..',
        modules,
        chunks: [{
            id: chunk,
            kind: 'js',
            bytes: spec.modules.reduce((sum, module) => sum + (module.bytes ?? 0), 0),
            entry: true,
            dynamicEntry: false,
            ...(entryModule === undefined ? {} : { entryModule }),
            imports: [],
            dynamicImports: [],
            css: [],
            assets: [],
        }],
        assets: [],
        imports: spec.imports ?? [],
    };
}
