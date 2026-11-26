export const SNAPSHOT_FORMAT = 'true-import-cost/build-snapshot';

export const SNAPSHOT_SCHEMA_VERSION = 1;

export type BuildMode = 'production' | 'development';

export type MeasurementPrecision =
    | 'bundler-reported'
    | 'sourcemap-estimate'
    | 'rendered-length'
    | 'proportional-estimate';

export const PRECISION_RANK: Readonly<Record<MeasurementPrecision, number>> = {
    'bundler-reported': 0,
    'sourcemap-estimate': 1,
    'rendered-length': 2,
    'proportional-estimate': 3,
};

export type ImportKind = 'static' | 'dynamic' | 'require' | 'css' | 'reference';

export type ChunkKind = 'js' | 'css';

export type AssetKind = 'image' | 'font' | 'wasm' | 'html' | 'sourcemap' | 'other';

export interface BundlerInfo {
    readonly name: string;
    readonly version?: string;
    readonly engine?: string;
}

export interface ModuleContribution {
    readonly chunkId: string;
    readonly bytes: number;
    readonly precision: MeasurementPrecision;
}

export interface ModuleRecord {
    readonly id: string;
    readonly path: string;
    readonly virtual?: boolean;
    readonly entry?: boolean;
    readonly packageName?: string;
    readonly packageVersion?: string;
    readonly packageRoot?: string;
    readonly sourceBytes?: number;
    readonly contributions: readonly ModuleContribution[];
}

export interface ChunkRecord {
    readonly id: string;
    readonly kind: ChunkKind;
    readonly bytes: number;
    readonly entry: boolean;
    readonly dynamicEntry: boolean;
    readonly entryModule?: string;
    readonly imports: readonly string[];
    readonly dynamicImports: readonly string[];
    readonly css: readonly string[];
    readonly assets: readonly string[];
}

export interface AssetRecord {
    readonly id: string;
    readonly kind: AssetKind;
    readonly bytes: number;
}

export interface ImportEdge {
    readonly importer: string;
    readonly specifier?: string;
    readonly resolvedModule?: string;
    readonly kind: ImportKind;
    readonly external: boolean;
    readonly retained?: boolean;
}

export interface BuildSnapshot {
    readonly format: typeof SNAPSHOT_FORMAT;
    readonly schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
    readonly id: string;
    readonly target: string;
    readonly createdAt: number;
    readonly bundler: BundlerInfo;
    readonly mode?: BuildMode;
    readonly root: string;
    readonly modules: readonly ModuleRecord[];
    readonly chunks: readonly ChunkRecord[];
    readonly assets: readonly AssetRecord[];
    readonly imports: readonly ImportEdge[];
}

export function assetKindOf(fileName: string): AssetKind {
    const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
    switch (extension) {
        case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': case 'avif': case 'ico': case 'bmp':
            return 'image';
        case 'woff': case 'woff2': case 'ttf': case 'otf': case 'eot':
            return 'font';
        case 'wasm':
            return 'wasm';
        case 'html': case 'htm':
            return 'html';
        case 'map':
            return 'sourcemap';
        default:
            return 'other';
    }
}

export function chunkKindOf(fileName: string): ChunkKind | undefined {
    if (/\.(m|c)?js$/i.test(fileName)) {
        return 'js';
    }
    if (/\.css$/i.test(fileName)) {
        return 'css';
    }
    return undefined;
}

export function totalOutputBytes(snapshot: BuildSnapshot): number {
    const chunks = snapshot.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    const assets = snapshot.assets.reduce((sum, asset) => (asset.kind === 'sourcemap' ? sum : sum + asset.bytes), 0);
    return chunks + assets;
}
