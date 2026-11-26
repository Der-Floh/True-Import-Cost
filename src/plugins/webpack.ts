import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMeasureRequest, SourceEdits, writeMeasureReport } from './measure';
import { addPackageVersions, DEFAULT_OUT_DIR, describeError, PLUGIN_NAME, sanitizeTarget, snapshotRoot, toPosix, writeSnapshot } from './shared';
import { normalizeWebpackStats } from '../core/adapters/webpack';
import { chunkKindOf } from '../core/schema/snapshot';

import type { MeasureRequest } from './measure';
import type { WebpackOutputFile } from '../core/adapters/webpack';
import type { BuildMode } from '../core/schema/snapshot';
import type { SourceMapLike } from '../core/sourcemap';

export interface TrueImportCostOptions {
    /** Name of the build target, such as `extension-host`. Defaults to webpack's `name`, then to the output file's name, then to the name of webpack's context directory. */
    readonly target?: string;
    /** Directory the snapshot is written to, relative to webpack's context. Defaults to `.true-import-cost`. */
    readonly outDir?: string;
    /** File name of the snapshot. Defaults to `<target>.json`. */
    readonly fileName?: string;
}

interface Tap {
    readonly name: string;
    readonly stage: number;
}

interface HookLike<Arguments extends unknown[], Result> {
    tap(options: string | Tap, callback: (...args: Arguments) => Result): void;
}

interface AsyncHookLike<Arguments extends unknown[]> {
    tapPromise(options: string | Tap, callback: (...args: Arguments) => Promise<void>): void;
}

interface AssetLike {
    readonly name: string;
    readonly source: { source(): string | Uint8Array };
    readonly info: { readonly related?: { readonly sourceMap?: unknown } | null };
}

interface CompilationLike {
    readonly compiler: unknown;
    getAssets(): readonly AssetLike[];
    getAsset(name: string): AssetLike | undefined | void;
}

interface StatsLike {
    hasErrors(): boolean;
    toJson(options: Readonly<Record<string, unknown>>): unknown;
}

/** The part of a webpack or Rspack compiler the plugin uses. */
export interface CompilerLike {
    readonly context: string;
    readonly options: {
        readonly name?: string;
        readonly mode?: string;
        readonly output: { readonly filename?: unknown; clean?: unknown };
        readonly optimization: { readonly minimize?: boolean };
        readonly module: { readonly rules: unknown[] };
    };
    readonly hooks: {
        readonly afterCompile: HookLike<[CompilationLike], void>;
        readonly shouldEmit: HookLike<[unknown], boolean | undefined>;
        readonly emit: HookLike<[unknown], void>;
        readonly done: AsyncHookLike<[StatsLike]>;
        readonly shutdown: HookLike<[], void>;
    };
    getInfrastructureLogger(name: string): { warn(...args: unknown[]): void };
}

type Editor = (file: string, source: string) => string;

const EDITORS = Symbol.for('true-import-cost.webpack-edits');

const LOADER = fileURLToPath(new URL('./webpackLoader.cjs', import.meta.url));

const FIRST: Tap = { name: PLUGIN_NAME, stage: Number.NEGATIVE_INFINITY };

const STATS_OPTIONS = {
    all: false,
    version: true,
    ids: true,
    assets: true,
    relatedAssets: true,
    cachedAssets: true,
    assetsSpace: Infinity,
    chunks: true,
    chunkRelations: true,
    modules: true,
    nestedModules: true,
    orphanModules: true,
    runtimeModules: true,
    cachedModules: true,
    modulesSpace: Infinity,
    nestedModulesSpace: Infinity,
    reasons: true,
    reasonsSpace: Infinity,
};

function editors(): Map<string, Editor> {
    const holder = globalThis as { [EDITORS]?: Map<string, Editor> };
    holder[EDITORS] ??= new Map();
    return holder[EDITORS];
}

function defaultTarget(compiler: CompilerLike): string {
    const { name, output } = compiler.options;
    if (name !== undefined && name !== '') {
        return name;
    }
    if (typeof output.filename === 'string' && !output.filename.includes('[')) {
        return path.basename(output.filename).replace(/\.[^.]+$/, '');
    }
    return path.basename(compiler.context);
}

function modeOf(options: CompilerLike['options']): BuildMode {
    if (options.mode === 'production' || options.mode === 'development') {
        return options.mode;
    }
    return options.optimization.minimize === true ? 'production' : 'development';
}

function preventEmitting(compiler: CompilerLike): void {
    compiler.options.output.clean = false;
    compiler.hooks.shouldEmit.tap(FIRST, () => false);
    compiler.hooks.emit.tap(FIRST, () => {
        throw new Error('True Import Cost is measuring this build, but another plugin turned emitting the output back on, so the build stops instead.');
    });
}

function loadEdited(compiler: CompilerLike, edits: SourceEdits): void {
    const key = randomUUID();
    editors().set(key, (file, source) => (edits.has(file) ? edits.apply(file, source) : source));
    compiler.hooks.shutdown.tap(PLUGIN_NAME, () => {
        editors().delete(key);
    });
    compiler.options.module.rules.push({ test: edits.filter(), enforce: 'pre', use: [{ loader: LOADER, options: { key } }] });
}

function textOf(asset: AssetLike): string {
    const source = asset.source.source();
    return typeof source === 'string' ? source : Buffer.from(source).toString('utf8');
}

function toSourceMap(value: unknown): SourceMapLike | undefined {
    if (typeof value !== 'object' || value === null || !('sources' in value) || !Array.isArray(value.sources) || !('mappings' in value) || typeof value.mappings !== 'string') {
        return undefined;
    }
    return { sources: value.sources.map(source => (typeof source === 'string' ? source : null)), mappings: value.mappings };
}

function sourceMappedOutput(compilation: CompilationLike, asset: AssetLike): WebpackOutputFile | undefined {
    const related: unknown = asset.info.related?.sourceMap;
    const name: unknown = Array.isArray(related) ? related[0] : related;
    const mapAsset = typeof name === 'string' && chunkKindOf(asset.name) !== undefined ? compilation.getAsset(name) : undefined;
    if (!mapAsset) {
        return undefined;
    }
    try {
        const map = toSourceMap(JSON.parse(textOf(mapAsset)));
        return map && { code: textOf(asset), map };
    } catch {
        return undefined;
    }
}

function sourceMappedOutputs(compilation: CompilationLike): Map<string, WebpackOutputFile> {
    const outputs = new Map<string, WebpackOutputFile>();
    try {
        for (const asset of compilation.getAssets()) {
            const output = sourceMappedOutput(compilation, asset);
            if (output) {
                outputs.set(asset.name, output);
            }
        }
    } catch {
        outputs.clear();
    }
    return outputs;
}

export class TrueImportCostPlugin {
    public readonly name = PLUGIN_NAME;
    private readonly options: TrueImportCostOptions;
    private readonly request: MeasureRequest | undefined;
    private readonly edits: SourceEdits | undefined;

    public constructor(options: TrueImportCostOptions = {}) {
        this.options = options;
        this.request = readMeasureRequest();
        this.edits = this.request === undefined ? undefined : new SourceEdits(this.request.edits);
    }

    public apply(compiler: CompilerLike): void {
        const target = sanitizeTarget(this.options.target ?? defaultTarget(compiler));
        const directory = this.request?.outDir ?? path.resolve(compiler.context, this.options.outDir ?? DEFAULT_OUT_DIR);
        const file = path.resolve(directory, this.options.fileName ?? `${target}.json`);
        const edits = this.edits;
        if (this.request !== undefined) {
            preventEmitting(compiler);
        }
        if (edits !== undefined && edits.size > 0) {
            loadEdited(compiler, edits);
        }

        let outputs = new Map<string, WebpackOutputFile>();
        compiler.hooks.afterCompile.tap(PLUGIN_NAME, (compilation) => {
            if (compilation.compiler === compiler) {
                outputs = sourceMappedOutputs(compilation);
            }
        });
        compiler.hooks.done.tapPromise(PLUGIN_NAME, async (stats) => {
            const mapped = outputs;
            outputs = new Map();
            if (stats.hasErrors()) {
                return;
            }
            try {
                const snapshot = normalizeWebpackStats(stats.toJson(STATS_OPTIONS), {
                    target,
                    createdAt: Date.now(),
                    root: snapshotRoot(file, compiler.context),
                    mode: modeOf(compiler.options),
                }, { baseDir: toPosix(compiler.context), outputs: mapped });
                await writeSnapshot(file, await addPackageVersions(snapshot, compiler.context));
                if (edits !== undefined) {
                    await writeMeasureReport(file, edits.report(target));
                }
            } catch (error: unknown) {
                compiler.getInfrastructureLogger(PLUGIN_NAME).warn(`Could not write the True Import Cost snapshot: ${describeError(error)}`);
            }
        });
    }
}

export function trueImportCost(options: TrueImportCostOptions = {}): TrueImportCostPlugin {
    return new TrueImportCostPlugin(options);
}

export default trueImportCost;
