import { isRecord } from './adapter';
import { splitProportionally } from './proportions';
import { SnapshotBuilder } from './snapshotBuilder';
import { dirname, isAbsolutePath, joinPath, normalizePath, relativePath, resolvePath, splitQuery } from '../paths';
import { assetKindOf, chunkKindOf } from '../schema/snapshot';
import { bytesPerSource } from '../sourcemap';

import type { BuildContext, BundlerAdapter } from './adapter';
import type { BuildSnapshot, MeasurementPrecision } from '../schema/snapshot';
import type { SourceMapLike } from '../sourcemap';

export const ROLLUP_BUILD_FORMAT = 'true-import-cost/rollup-build';

export interface RollupModuleInput {
    readonly id: string;
    readonly isEntry: boolean;
    readonly isExternal?: boolean;
    readonly importedIds: readonly string[];
    readonly dynamicallyImportedIds: readonly string[];
}

export interface RollupRenderedModuleInput {
    readonly id: string;
    readonly renderedLength: number;
}

export interface RollupChunkInput {
    readonly fileName: string;
    readonly bytes: number;
    readonly isEntry: boolean;
    readonly isDynamicEntry: boolean;
    readonly facadeModuleId?: string | null;
    readonly modules: readonly RollupRenderedModuleInput[];
    readonly imports: readonly string[];
    readonly dynamicImports: readonly string[];
    readonly importedCss?: readonly string[];
    readonly importedAssets?: readonly string[];
    readonly code?: string;
    readonly map?: SourceMapLike | null;
}

export interface RollupAssetInput {
    readonly fileName: string;
    readonly bytes: number;
    readonly originalFileNames?: readonly string[];
}

export interface RollupBuildInput {
    readonly format: typeof ROLLUP_BUILD_FORMAT;
    readonly baseDir: string;
    readonly outDir: string;
    readonly chunks: readonly RollupChunkInput[];
    readonly assets: readonly RollupAssetInput[];
    readonly modules: readonly RollupModuleInput[];
    readonly cssSourceLengths?: Readonly<Record<string, number>>;
}

interface ModuleName {
    readonly id: string;
    readonly path: string;
    readonly virtual: boolean;
    readonly absolutePath?: string;
}

const CSS_MODULE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/i;
const VUE_STYLE_BLOCK = /[?&]type=style(&|$)/;
const INLINED_CSS = /[?&](inline|raw|url)(&|=|$)/;

export function isCssModuleId(id: string): boolean {
    const { path, query } = splitQuery(id.replace(/^\0/, ''));
    if (INLINED_CSS.test(query)) {
        return false;
    }
    return CSS_MODULE.test(path) || VUE_STYLE_BLOCK.test(query) || /[?&]lang\.(css|less|sass|scss|styl|stylus|postcss)(&|$)/.test(query);
}

function nameModule(rawId: string, baseDir: string): ModuleName {
    const virtualPrefix = rawId.startsWith('\0');
    const body = virtualPrefix ? rawId.slice(1) : rawId;
    const { path, query } = splitQuery(body);
    if (!isAbsolutePath(path)) {
        return { id: rawId, path: body, virtual: true };
    }
    const absolutePath = normalizePath(path);
    const relative = relativePath(baseDir, absolutePath);
    return {
        id: `${virtualPrefix ? '\0' : ''}${relative}${query}`,
        path: relative,
        virtual: virtualPrefix,
        absolutePath,
    };
}

function isBareId(rawId: string): boolean {
    return !rawId.startsWith('\0') && !isAbsolutePath(splitQuery(rawId).path);
}

interface Estimate {
    readonly bytes: number;
    readonly precision: MeasurementPrecision;
}

function sourcemapBytes(chunk: RollupChunkInput, outDir: string, names: ReadonlyMap<string, ModuleName>): Map<string, number> | undefined {
    if (!chunk.map || chunk.code === undefined) {
        return undefined;
    }
    let totals: number[];
    try {
        totals = bytesPerSource(chunk.code, chunk.map);
    } catch {
        return undefined;
    }

    const sourceBase = resolvePath(dirname(joinPath(outDir, chunk.fileName)), chunk.map.sourceRoot ?? '');
    const bytesByPath = new Map<string, number>();
    chunk.map.sources.forEach((source, index) => {
        if (source === null || source === '') {
            return;
        }
        const { path } = splitQuery(source.replace(/^\0/, ''));
        const absolute = resolvePath(sourceBase, path);
        bytesByPath.set(absolute, (bytesByPath.get(absolute) ?? 0) + (totals[index] ?? 0));
    });

    const groups = new Map<string, RollupRenderedModuleInput[]>();
    for (const module of chunk.modules) {
        const absolute = names.get(module.id)?.absolutePath;
        if (absolute === undefined || !bytesByPath.has(absolute)) {
            continue;
        }
        groups.set(absolute, [...(groups.get(absolute) ?? []), module]);
    }

    const result = new Map<string, number>();
    for (const [absolute, modules] of groups) {
        const shares = splitProportionally(bytesByPath.get(absolute) ?? 0, modules.map(module => module.renderedLength));
        modules.forEach((module, index) => result.set(module.id, shares[index] ?? 0));
    }
    return result;
}

function estimateChunk(chunk: RollupChunkInput, outDir: string, names: ReadonlyMap<string, ModuleName>): Map<string, Estimate> {
    const estimates = new Map<string, Estimate>();
    const mapped = sourcemapBytes(chunk, outDir, names) ?? new Map<string, number>();

    let mappedTotal = 0;
    for (const [id, bytes] of mapped) {
        estimates.set(id, { bytes, precision: 'sourcemap-estimate' });
        mappedTotal += bytes;
    }

    const rest = chunk.modules.filter(module => !mapped.has(module.id));
    const renderedTotal = rest.reduce((sum, module) => sum + module.renderedLength, 0);
    const available = Math.max(0, chunk.bytes - mappedTotal);
    const factor = renderedTotal > available && renderedTotal > 0 ? available / renderedTotal : 1;
    const precision: MeasurementPrecision = factor < 1 ? 'proportional-estimate' : 'rendered-length';
    for (const module of rest) {
        estimates.set(module.id, { bytes: module.renderedLength * factor, precision });
    }
    return estimates;
}

export function isRollupBuildInput(value: unknown): value is RollupBuildInput {
    return isRecord(value) && value.format === ROLLUP_BUILD_FORMAT && Array.isArray(value.chunks) && Array.isArray(value.modules);
}

export function normalizeRollupBuild(input: RollupBuildInput, context: BuildContext): BuildSnapshot {
    const baseDir = normalizePath(input.baseDir);
    const outDir = normalizePath(input.outDir);
    const builder = new SnapshotBuilder();
    const names = new Map<string, ModuleName>();
    const name = (rawId: string): ModuleName => {
        let found = names.get(rawId);
        if (!found) {
            found = nameModule(rawId, baseDir);
            names.set(rawId, found);
        }
        return found;
    };

    const chunkFiles = new Set(input.chunks.map(chunk => chunk.fileName));
    const rendered = new Set(input.chunks.flatMap(chunk => chunk.modules.map(module => module.id)));
    const retainedExternals = new Set(
        input.chunks.flatMap(chunk => [...chunk.imports, ...chunk.dynamicImports]).filter(id => !chunkFiles.has(id)),
    );
    const declaredExternal = new Set(input.modules.filter(module => module.isExternal === true).map(module => module.id));
    const isExternal = (rawId: string): boolean =>
        declaredExternal.has(rawId) || retainedExternals.has(rawId) || (!rendered.has(rawId) && isBareId(rawId));

    const addModule = (rawId: string): string => {
        const named = name(rawId);
        builder.module(named.id, named.path, { virtual: named.virtual });
        return named.id;
    };

    for (const module of input.modules) {
        if (!isExternal(module.id)) {
            addModule(module.id);
        }
    }
    for (const id of rendered) {
        addModule(id);
    }

    for (const module of input.modules) {
        if (isExternal(module.id)) {
            continue;
        }
        const importer = name(module.id).id;
        if (module.isEntry) {
            builder.markEntry(importer);
        }
        const edges = [
            ...module.importedIds.map(id => ({ id, kind: 'static' as const })),
            ...module.dynamicallyImportedIds.map(id => ({ id, kind: 'dynamic' as const })),
        ];
        for (const { id, kind } of edges) {
            if (isExternal(id)) {
                builder.edge({ importer, specifier: id, kind, external: true, retained: retainedExternals.has(id) });
            } else {
                builder.edge({ importer, resolvedModule: addModule(id), kind, external: false });
            }
        }
    }

    for (const chunk of input.chunks) {
        for (const [id, estimate] of estimateChunk(chunk, outDir, names)) {
            builder.contribute(name(id).id, chunk.fileName, estimate.bytes, estimate.precision);
        }
    }

    const assets = new Map(input.assets.map(asset => [asset.fileName, asset]));
    const cssLengths = input.cssSourceLengths ?? {};
    const claimedCss = new Set<string>();
    const cssModulesByAsset = new Map<string, Set<string>>();
    for (const chunk of input.chunks) {
        const cssModules = chunk.modules.map(module => module.id).filter(isCssModuleId);
        for (const cssFile of chunk.importedCss ?? []) {
            claimedCss.add(cssFile);
            const set = cssModulesByAsset.get(cssFile) ?? new Set<string>();
            cssModules.forEach(id => set.add(id));
            cssModulesByAsset.set(cssFile, set);
        }
    }
    const allCssModules = [...rendered].filter(isCssModuleId);
    for (const asset of input.assets) {
        if (chunkKindOf(asset.fileName) === 'css' && !claimedCss.has(asset.fileName)) {
            cssModulesByAsset.set(asset.fileName, new Set(allCssModules));
        }
    }

    for (const [cssFile, moduleIds] of cssModulesByAsset) {
        const asset = assets.get(cssFile);
        if (!asset) {
            continue;
        }
        builder.chunk({
            id: cssFile,
            kind: 'css',
            bytes: asset.bytes,
            entry: false,
            dynamicEntry: false,
            imports: [],
            dynamicImports: [],
            css: [],
            assets: [],
        });
        const ids = [...moduleIds];
        const shares = splitProportionally(asset.bytes, ids.map(id => cssLengths[id] ?? 0));
        ids.forEach((id, index) => builder.contribute(name(id).id, cssFile, shares[index] ?? 0, 'proportional-estimate'));
    }

    const modulesByAbsolutePath = new Map<string, string>();
    for (const named of names.values()) {
        if (named.absolutePath !== undefined && !named.virtual && !modulesByAbsolutePath.has(named.absolutePath)) {
            modulesByAbsolutePath.set(named.absolutePath, named.id);
        }
    }
    for (const asset of input.assets) {
        if (builder.hasOutput(asset.fileName) || chunkKindOf(asset.fileName) === 'css') {
            continue;
        }
        builder.asset({ id: asset.fileName, kind: assetKindOf(asset.fileName), bytes: asset.bytes });
        for (const original of asset.originalFileNames ?? []) {
            const moduleId = modulesByAbsolutePath.get(resolvePath(baseDir, original));
            if (moduleId !== undefined) {
                builder.contribute(moduleId, asset.fileName, asset.bytes, 'bundler-reported');
            }
        }
    }

    for (const chunk of input.chunks) {
        if (chunkKindOf(chunk.fileName) === 'css') {
            continue;
        }
        const facade = chunk.facadeModuleId;
        const entryModule = facade === undefined || facade === null || isExternal(facade) ? undefined : name(facade).id;
        builder.chunk({
            id: chunk.fileName,
            kind: 'js',
            bytes: chunk.bytes,
            entry: chunk.isEntry,
            dynamicEntry: chunk.isDynamicEntry,
            ...(entryModule === undefined ? {} : { entryModule }),
            imports: chunk.imports.filter(id => chunkFiles.has(id)),
            dynamicImports: chunk.dynamicImports.filter(id => chunkFiles.has(id)),
            css: (chunk.importedCss ?? []).filter(id => assets.has(id)),
            assets: (chunk.importedAssets ?? []).filter(id => assets.has(id)),
        });
    }

    return builder.build({ bundler: { name: 'rollup' }, ...context });
}

export const rollupAdapter: BundlerAdapter<RollupBuildInput> = {
    name: 'rollup',
    supports: isRollupBuildInput,
    normalize: (input, context) => Promise.resolve(normalizeRollupBuild(input, context)),
};
