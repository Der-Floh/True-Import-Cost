import path from 'node:path';

import { addPackageVersions, DEFAULT_OUT_DIR, describeError, PLUGIN_NAME, sanitizeTarget, snapshotRoot, toPosix, writeSnapshot } from './shared';
import { isCssModuleId, normalizeRollupBuild, ROLLUP_BUILD_FORMAT } from '../core/adapters/rollup';

import type { RollupAssetInput, RollupBuildInput, RollupChunkInput, RollupModuleInput } from '../core/adapters/rollup';
import type { Plugin, ResolvedConfig } from 'vite';

export interface TrueImportCostOptions {
    /** Name of the build target, such as `webview`. Defaults to the name of Vite's root directory. */
    readonly target?: string;
    /** Directory the snapshot is written to, relative to Vite's root. Defaults to `.true-import-cost`. */
    readonly outDir?: string;
    /** File name of the snapshot. Defaults to `<target>.json`. */
    readonly fileName?: string;
}

interface OutputChunkLike {
    readonly type: 'chunk';
    readonly fileName: string;
    readonly code: string;
    readonly isEntry: boolean;
    readonly isDynamicEntry: boolean;
    readonly facadeModuleId: string | null;
    readonly modules: Readonly<Record<string, { readonly renderedLength: number }>>;
    readonly imports: readonly string[];
    readonly dynamicImports: readonly string[];
    readonly map?: { readonly sources: readonly (string | null)[]; readonly mappings: string; readonly sourceRoot?: string } | null;
    readonly viteMetadata?: { readonly importedCss: ReadonlySet<string>; readonly importedAssets: ReadonlySet<string> };
}

interface OutputAssetLike {
    readonly type: 'asset';
    readonly fileName: string;
    readonly source: string | Uint8Array;
    readonly originalFileName?: string | null;
    readonly originalFileNames?: readonly string[];
}

interface ModuleInfoLike {
    readonly isEntry: boolean;
    readonly isExternal?: boolean;
    readonly importedIds: readonly string[];
    readonly dynamicallyImportedIds: readonly string[];
}

interface PluginContextLike {
    readonly meta?: { readonly viteVersion?: string; readonly rollupVersion?: string; readonly rolldownVersion?: string };
    getModuleIds(): IterableIterator<string>;
    getModuleInfo(id: string): ModuleInfoLike | null;
    warn(message: string): void;
}

const CSS_FILTER = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(\?|$)|[?&]type=style/;

function toChunk(chunk: OutputChunkLike): RollupChunkInput {
    const map = chunk.map ?? null;
    return {
        fileName: chunk.fileName,
        bytes: Buffer.byteLength(chunk.code),
        isEntry: chunk.isEntry,
        isDynamicEntry: chunk.isDynamicEntry,
        facadeModuleId: chunk.facadeModuleId,
        modules: Object.entries(chunk.modules).map(([id, module]) => ({ id, renderedLength: module.renderedLength })),
        imports: [...chunk.imports],
        dynamicImports: [...chunk.dynamicImports],
        importedCss: [...(chunk.viteMetadata?.importedCss ?? [])],
        importedAssets: [...(chunk.viteMetadata?.importedAssets ?? [])],
        ...(map === null ? {} : {
            code: chunk.code,
            map: { sources: map.sources, mappings: map.mappings, ...(map.sourceRoot === undefined ? {} : { sourceRoot: map.sourceRoot }) },
        }),
    };
}

function toAsset(asset: OutputAssetLike, root: string): RollupAssetInput {
    const originals = asset.originalFileNames ?? (asset.originalFileName ? [asset.originalFileName] : []);
    return {
        fileName: asset.fileName,
        bytes: typeof asset.source === 'string' ? Buffer.byteLength(asset.source) : asset.source.byteLength,
        originalFileNames: originals.map(original => toPosix(path.resolve(root, original))),
    };
}

function engineOf(meta: PluginContextLike['meta']): string | undefined {
    if (meta?.rolldownVersion !== undefined) {
        return `rolldown ${meta.rolldownVersion}`;
    }
    return meta?.rollupVersion === undefined ? undefined : `rollup ${meta.rollupVersion}`;
}

export function trueImportCost(options: TrueImportCostOptions = {}): Plugin {
    let config: ResolvedConfig | undefined;
    const cssSourceLengths = new Map<string, number>();
    let primaryFormat: string | undefined;

    return {
        name: PLUGIN_NAME,
        apply: 'build',
        enforce: 'post',

        configResolved(resolved) {
            config = resolved;
        },

        buildStart() {
            cssSourceLengths.clear();
        },

        closeBundle() {
            primaryFormat = undefined;
        },

        transform: {
            order: 'pre',
            filter: { id: CSS_FILTER },
            handler(code, id) {
                if (isCssModuleId(id)) {
                    cssSourceLengths.set(id, code.length);
                }
                return null;
            },
        },

        generateBundle: {
            order: 'post',
            async handler(outputOptions, bundle) {
                const context = this as unknown as PluginContextLike;
                const root = toPosix(path.resolve(config?.root ?? process.cwd()));
                const target = sanitizeTarget(options.target ?? path.basename(root));
                const outputDir = outputOptions.dir ?? (outputOptions.file === undefined ? path.resolve(root, 'dist') : path.dirname(outputOptions.file));
                primaryFormat ??= outputOptions.format;
                const fileName = options.fileName ?? (outputOptions.format === primaryFormat ? `${target}.json` : `${target}.${outputOptions.format}.json`);
                const file = path.resolve(root, options.outDir ?? DEFAULT_OUT_DIR, fileName);

                try {
                    const items = Object.values(bundle) as unknown as (OutputChunkLike | OutputAssetLike)[];
                    const modules: RollupModuleInput[] = [];
                    for (const id of context.getModuleIds()) {
                        const info = context.getModuleInfo(id);
                        if (!info) {
                            continue;
                        }
                        modules.push({
                            id,
                            isEntry: info.isEntry,
                            ...(info.isExternal === undefined ? {} : { isExternal: info.isExternal }),
                            importedIds: [...info.importedIds],
                            dynamicallyImportedIds: [...info.dynamicallyImportedIds],
                        });
                    }
                    const input: RollupBuildInput = {
                        format: ROLLUP_BUILD_FORMAT,
                        baseDir: root,
                        outDir: toPosix(path.resolve(root, outputDir)),
                        chunks: items.filter((item): item is OutputChunkLike => item.type === 'chunk').map(toChunk),
                        assets: items.filter((item): item is OutputAssetLike => item.type === 'asset').map(asset => toAsset(asset, root)),
                        modules,
                        cssSourceLengths: Object.fromEntries(cssSourceLengths),
                    };
                    const engine = engineOf(context.meta);
                    const version = context.meta?.viteVersion;
                    const snapshot = normalizeRollupBuild(input, {
                        target,
                        createdAt: Date.now(),
                        root: snapshotRoot(file, root),
                        bundler: {
                            name: 'vite',
                            ...(version === undefined ? {} : { version }),
                            ...(engine === undefined ? {} : { engine }),
                        },
                        mode: config?.mode === 'development' ? 'development' : 'production',
                    });
                    await writeSnapshot(file, await addPackageVersions(snapshot, root));
                } catch (error: unknown) {
                    context.warn(`Could not write the True Import Cost snapshot: ${describeError(error)}`);
                }
            },
        },
    };
}

export default trueImportCost;
