export const CONTEXT = '/work/app';

export interface StatsReasonJson {
    readonly type: string | null;
    readonly moduleIdentifier: string | null;
    readonly resolvedModuleIdentifier: string | null;
    readonly userRequest: string | null;
}

export interface StatsModuleJson {
    readonly identifier: string;
    readonly name: string;
    readonly nameForCondition?: string | null;
    readonly moduleType: string;
    readonly size: number;
    readonly sizes: Readonly<Record<string, number>>;
    readonly chunks: readonly (string | number)[];
    readonly reasons: readonly StatsReasonJson[];
    readonly modules?: readonly StatsModuleJson[];
}

export interface StatsChunkJson {
    readonly id: string | number;
    readonly files: readonly string[];
    readonly auxiliaryFiles: readonly string[];
    readonly initial: boolean;
    readonly siblings: readonly (string | number)[];
    readonly children: readonly (string | number)[];
}

export interface StatsAssetJson {
    readonly name: string;
    readonly size: number;
    readonly info: Readonly<Record<string, unknown>>;
    readonly related?: readonly StatsAssetJson[];
}

export interface ModuleSpec {
    readonly name?: string;
    readonly moduleType?: string;
    readonly size?: number;
    readonly sizes?: Readonly<Record<string, number>>;
    readonly chunks?: readonly (string | number)[];
    readonly reasons?: readonly StatsReasonJson[];
}

export function at(path: string): string {
    return `${CONTEXT}/${path}`;
}

export function statsModule(path: string, spec: ModuleSpec = {}): StatsModuleJson {
    const size = spec.size ?? 100;
    return {
        identifier: at(path),
        name: spec.name ?? `./${path}`,
        nameForCondition: at(path.replace(/\?.*$/, '')),
        moduleType: spec.moduleType ?? 'javascript/auto',
        size,
        sizes: spec.sizes ?? { javascript: size },
        chunks: spec.chunks ?? [],
        reasons: spec.reasons ?? [],
    };
}

export function concatenated(root: StatsModuleJson, inner: readonly StatsModuleJson[], spec: Pick<ModuleSpec, 'chunks' | 'reasons'>): StatsModuleJson {
    const size = [root, ...inner].reduce((sum, module) => sum + module.size, 0);
    return {
        identifier: `${root.identifier}|5b2cbdd8c4aa8fc8`,
        name: `${root.name} + ${inner.length} modules`,
        nameForCondition: root.nameForCondition ?? null,
        moduleType: 'javascript/esm',
        size,
        sizes: { javascript: size },
        chunks: spec.chunks ?? [],
        reasons: spec.reasons ?? [],
        modules: [root, ...inner],
    };
}

export function externalModule(request: string, spec: Pick<ModuleSpec, 'chunks' | 'reasons'> = {}): StatsModuleJson {
    return {
        identifier: `external commonjs ${JSON.stringify(request)}`,
        name: `external ${JSON.stringify(request)}`,
        nameForCondition: null,
        moduleType: 'javascript/dynamic',
        size: 42,
        sizes: { javascript: 42 },
        chunks: spec.chunks ?? [],
        reasons: spec.reasons ?? [],
    };
}

export function runtimeModule(name: string, size: number, chunks: readonly (string | number)[]): StatsModuleJson {
    return { identifier: `webpack/runtime/${name}`, name: `webpack/runtime/${name}`, nameForCondition: null, moduleType: 'runtime', size, sizes: { runtime: size }, chunks, reasons: [] };
}

export function reason(type: string, from: string | null, userRequest: string | null = null): StatsReasonJson {
    const identifier = from === null ? null : at(from);
    return { type, moduleIdentifier: identifier, resolvedModuleIdentifier: identifier, userRequest };
}

export function entryReason(request: string): StatsReasonJson {
    return reason('entry', null, request);
}

export function statsChunk(id: string | number, files: readonly string[], spec: Partial<Omit<StatsChunkJson, 'id' | 'files'>> = {}): StatsChunkJson {
    return { id, files, auxiliaryFiles: [], initial: false, siblings: [], children: [], ...spec };
}

export function statsAsset(name: string, size: number, info: Readonly<Record<string, unknown>> = {}, related: readonly StatsAssetJson[] = []): StatsAssetJson {
    return { name, size, info, ...(related.length === 0 ? {} : { related }) };
}

export function stats(spec: { modules: readonly StatsModuleJson[]; chunks: readonly StatsChunkJson[]; assets: readonly StatsAssetJson[] }, extra: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    return { version: '5.113.0', outputPath: `${CONTEXT}/dist`, ...extra, ...spec };
}
