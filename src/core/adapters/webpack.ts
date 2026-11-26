import { isRecord, MetadataError } from './adapter';
import { splitProportionally } from './proportions';
import { SnapshotBuilder } from './snapshotBuilder';
import { isAbsolutePath, normalizePath, relativePath, splitQuery } from '../paths';
import { assetKindOf, chunkKindOf } from '../schema/snapshot';
import { bytesPerSource } from '../sourcemap';

import type { BuildContext, BundlerAdapter } from './adapter';
import type { BuildSnapshot, BundlerInfo, ChunkKind, ImportEdge, ImportKind, MeasurementPrecision } from '../schema/snapshot';
import type { SourceMapLike } from '../sourcemap';

export interface WebpackStats {
    readonly version?: string;
    readonly rspackVersion?: string;
    readonly modules?: readonly unknown[];
    readonly chunks?: readonly unknown[];
    readonly assets?: readonly unknown[];
}

export interface WebpackOutputFile {
    readonly code: string;
    readonly map: SourceMapLike;
}

export interface WebpackBuildDetails {
    readonly baseDir?: string;
    readonly outputs?: ReadonlyMap<string, WebpackOutputFile>;
}

type ChunkKey = string;

interface StatsReason {
    readonly type: string;
    readonly origin?: string;
    readonly userRequest?: string;
}

interface StatsModule {
    readonly identifier: string;
    readonly name: string;
    readonly moduleType: string;
    readonly size: number;
    readonly sizes: readonly (readonly [string, number])[];
    readonly hasResource: boolean;
    readonly chunks: readonly ChunkKey[];
    readonly reasons: readonly StatsReason[];
    readonly inner: readonly StatsModule[];
}

interface StatsChunk {
    readonly key: ChunkKey;
    readonly files: readonly string[];
    readonly auxiliaryFiles: readonly string[];
    readonly initial: boolean;
    readonly siblings: readonly ChunkKey[];
    readonly children: readonly ChunkKey[];
}

interface StatsAsset {
    readonly name: string;
    readonly bytes: number;
    readonly sourceFilename?: string;
}

interface Stats {
    readonly bundler: BundlerInfo;
    readonly modules: readonly StatsModule[];
    readonly chunks: readonly StatsChunk[];
    readonly assets: readonly StatsAsset[];
}

interface Leaf {
    readonly identifier: string;
    readonly id: string;
    readonly path: string;
    readonly virtual: boolean;
    readonly module: StatsModule;
    readonly chunks: Set<ChunkKey>;
}

interface External {
    readonly request: string;
    retained: boolean;
}

interface TargetedReason {
    readonly target: string;
    readonly reason: StatsReason;
}

interface ModuleIndex {
    readonly leaves: Map<string, Leaf>;
    readonly externals: Map<string, External>;
    readonly roots: Map<string, string>;
    readonly reasons: TargetedReason[];
}

interface ImportFacts {
    readonly entries: ReadonlySet<string>;
    readonly lazy: ReadonlySet<string>;
}

interface Weighted {
    readonly leaf: Leaf;
    readonly weight: number;
}

interface Estimate {
    readonly bytes: number;
    readonly precision: MeasurementPrecision;
}

interface OutputFiles {
    readonly sizes: ReadonlyMap<string, number>;
    readonly chunks: ReadonlyMap<ChunkKey, readonly string[]>;
    readonly chunkFiles: ReadonlySet<string>;
}

type ReasonUse = 'entry' | { readonly kind: ImportKind; readonly perBinding: boolean } | undefined;

const STATS_KEYS = ['assetsByChunkName', 'namedChunkGroups', 'entrypoints', 'errorsCount', 'warningsCount', 'builtAt', 'outputPath', 'filteredModules'];

const MAX_VERSION_LENGTH = 256;

const CONCATENATED_NAME = / \+ \d+ modules?$/;

const RESOURCE_START = /(?<=^|\s)(?:\.{1,2}\/|\/|[a-zA-Z]:\/)/;

const WEBPACK_SOURCE = /^webpack:\/\/[^/]*\//;

const ENTRY_REASON = /(^|\s)entry$/;
const IGNORED_REASON = /\bhot\b|webpackHot|accept|decline|__webpack_is_included__|self exports reference|export (header|expression|specifier)$/;
const PER_BINDING_REASON = /(import specifier|export imported specifier|export import specifier)$/;
const DYNAMIC_REASON = /import\(\)|dynamic import|require\.ensure|new Worker|Worklet|\blazy\b/;
const REFERENCE_REASON = /resolve|new URL|url\(\)|css url|script url/;
const CSS_REASON = /^css (@import|:import|import)$/;
const REQUIRE_REASON = /require|^(cjs|amd|commonjs)\b/;

const JS_SOURCE_TYPES: ReadonlySet<string> = new Set(['javascript', 'runtime', 'remote', 'share-init', 'consume-shared']);

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const list = map.get(key);
    if (list) {
        list.push(value);
    } else {
        map.set(key, [value]);
    }
}

function labelOf(bundler: BundlerInfo): string {
    return bundler.name === 'rspack' ? 'Rspack' : 'webpack';
}

function incomplete(bundler: BundlerInfo, problem: string): MetadataError {
    return new MetadataError(`the ${labelOf(bundler)} stats ${problem}; write complete stats with \`stats.toJson({ all: true })\`, or with \`--json\` and the stats option \`all: true\`, or add the @true-import-cost/webpack plugin to the build`);
}

function bundlerOf(value: Record<string, unknown>): BundlerInfo {
    const rspack = typeof value.rspackVersion === 'string';
    const name = rspack ? 'rspack' : 'webpack';
    const version = rspack ? value.rspackVersion : value.version;
    return typeof version === 'string' && version !== '' && version.length <= MAX_VERSION_LENGTH ? { name, version } : { name };
}

function byteCount(value: unknown, where: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new MetadataError(`${where} is not a byte count`);
    }
    return value;
}

function readKeys(value: unknown): ChunkKey[] {
    return Array.isArray(value) ? value.filter(key => typeof key === 'string' || typeof key === 'number').map(String) : [];
}

function readStrings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readReason(value: unknown): StatsReason[] {
    if (!isRecord(value) || typeof value.type !== 'string') {
        return [];
    }
    const origin = typeof value.resolvedModuleIdentifier === 'string' ? value.resolvedModuleIdentifier : value.moduleIdentifier;
    return [{
        type: value.type,
        ...(typeof origin === 'string' ? { origin } : {}),
        ...(typeof value.userRequest === 'string' && value.userRequest !== '' ? { userRequest: value.userRequest } : {}),
    }];
}

function readSizes(value: unknown, where: string): [string, number][] {
    return isRecord(value) ? Object.keys(value).map(type => [type, byteCount(value[type], `${where} size "${type}"`)]) : [];
}

function readModule(value: unknown, bundler: BundlerInfo, nested = false): StatsModule {
    if (!isRecord(value) || typeof value.identifier !== 'string' || typeof value.name !== 'string') {
        throw incomplete(bundler, 'list modules without an identifier or a name');
    }
    const where = `module "${value.name}"`;
    const inner = !nested && Array.isArray(value.modules) ? value.modules.map(entry => readModule(entry, bundler, true)) : [];
    if (!nested && inner.length === 0 && CONCATENATED_NAME.test(value.name)) {
        throw incomplete(bundler, 'do not list the modules inside concatenated modules');
    }
    return {
        identifier: value.identifier,
        name: value.name,
        moduleType: typeof value.moduleType === 'string' ? value.moduleType : '',
        size: byteCount(value.size, where),
        sizes: readSizes(value.sizes, where),
        hasResource: value.nameForCondition === undefined || (typeof value.nameForCondition === 'string' && value.nameForCondition !== ''),
        chunks: readKeys(value.chunks),
        reasons: Array.isArray(value.reasons) ? value.reasons.flatMap(readReason) : [],
        inner,
    };
}

function readChunk(value: unknown, bundler: BundlerInfo): StatsChunk {
    if (!isRecord(value) || (typeof value.id !== 'string' && typeof value.id !== 'number')) {
        throw incomplete(bundler, 'list chunks without an id');
    }
    return {
        key: String(value.id),
        files: readStrings(value.files),
        auxiliaryFiles: readStrings(value.auxiliaryFiles),
        initial: value.initial === true,
        siblings: readKeys(value.siblings),
        children: readKeys(value.children),
    };
}

function readAssets(values: readonly unknown[]): StatsAsset[] {
    return values.flatMap((value): StatsAsset[] => {
        if (!isRecord(value) || typeof value.name !== 'string') {
            throw new MetadataError('the stats list an asset without a name');
        }
        const info = isRecord(value.info) ? value.info : {};
        const asset: StatsAsset = {
            name: value.name,
            bytes: byteCount(value.size, `asset "${value.name}"`),
            ...(typeof info.sourceFilename === 'string' ? { sourceFilename: info.sourceFilename } : {}),
        };
        return [asset, ...(Array.isArray(value.related) ? readAssets(value.related) : [])];
    });
}

function compilationOf(value: Record<string, unknown>, bundler: BundlerInfo): Record<string, unknown> {
    if (value.modules !== undefined || !Array.isArray(value.children)) {
        return value;
    }
    const children = value.children.filter(isRecord);
    const [only] = children;
    if (children.length === 1 && only) {
        return compilationOf(only, bundler);
    }
    if (children.length > 1) {
        throw new MetadataError(`the ${labelOf(bundler)} stats describe ${children.length} compilations; write the stats of each compilation to a file of its own, or add the @true-import-cost/webpack plugin, which writes a snapshot for each`);
    }
    return value;
}

function assertListed(bundler: BundlerInfo, modules: readonly unknown[], field: 'chunks' | 'reasons', problem: string): void {
    if (modules.length > 0 && !modules.some(module => isRecord(module) && Array.isArray(module[field]))) {
        throw incomplete(bundler, problem);
    }
}

function readStats(input: unknown): Stats {
    if (!isRecord(input)) {
        throw new MetadataError('the metadata is not webpack stats');
    }
    const bundler = bundlerOf(input);
    const compilation = compilationOf(input, bundler);
    const { modules, chunks, assets } = compilation;
    if (!Array.isArray(modules)) {
        throw incomplete(bundler, 'have no modules');
    }
    if (!Array.isArray(chunks)) {
        throw incomplete(bundler, 'have no chunks');
    }
    if (!Array.isArray(assets)) {
        throw incomplete(bundler, 'have no assets');
    }
    for (const [field, what] of [['filteredModules', 'modules'], ['filteredAssets', 'assets']] as const) {
        const left = compilation[field];
        if (typeof left === 'number' && left > 0) {
            throw incomplete(bundler, `leave out ${left} ${what}`);
        }
    }
    assertListed(bundler, modules, 'chunks', 'do not say which chunks the modules are in');
    assertListed(bundler, modules, 'reasons', 'do not list why each module was included, which is where the imports between modules are');
    return {
        bundler,
        modules: modules.map(module => readModule(module, bundler)),
        chunks: chunks.map(chunk => readChunk(chunk, bundler)),
        assets: [...new Map(readAssets(assets).map(asset => [asset.name, asset])).values()],
    };
}

function isExternal(module: StatsModule): boolean {
    return module.identifier.startsWith('external ');
}

function externalRequest(module: StatsModule): string {
    const quoted = module.name.replace(/^external /, '');
    try {
        const request: unknown = JSON.parse(quoted);
        return typeof request === 'string' ? request : quoted;
    } catch {
        return quoted;
    }
}

function resourceOf(module: StatsModule): string | undefined {
    const request = module.name.slice(module.name.lastIndexOf('!') + 1);
    const start = module.hasResource ? request.search(RESOURCE_START) : -1;
    return start < 0 ? undefined : request.slice(start);
}

function nameOf(module: StatsModule): Pick<Leaf, 'id' | 'path' | 'virtual'> {
    const resource = resourceOf(module);
    if (resource === undefined) {
        const name = module.name.replace(/^\.\//, '');
        return { id: name, path: name, virtual: true };
    }
    const { path, query } = splitQuery(resource);
    const normalized = normalizePath(path);
    return { id: `${normalized}${query}`, path: normalized, virtual: false };
}

function uniqueId(id: string, moduleType: string, taken: Set<string>): string {
    let candidate = id;
    for (let attempt = 1; taken.has(candidate); attempt++) {
        candidate = attempt === 1 ? `${id}|${moduleType}` : `${id}|${moduleType}|${attempt}`;
    }
    taken.add(candidate);
    return candidate;
}

function rootOf(module: StatsModule): StatsModule | undefined {
    const separator = module.identifier.lastIndexOf('|');
    const rootIdentifier = module.identifier.slice(0, separator);
    const rootName = module.name.replace(CONCATENATED_NAME, '');
    return module.inner.find(inner => separator > 0 && inner.identifier === rootIdentifier)
        ?? module.inner.find(inner => inner.name === rootName)
        ?? module.inner.find(inner => !isExternal(inner));
}

function indexModules(modules: readonly StatsModule[]): ModuleIndex {
    const index: ModuleIndex = { leaves: new Map(), externals: new Map(), roots: new Map(), reasons: [] };
    const takenIds = new Set<string>();
    const visit = (module: StatsModule, chunks: readonly ChunkKey[]): void => {
        if (isExternal(module)) {
            const external = index.externals.get(module.identifier) ?? { request: externalRequest(module), retained: false };
            external.retained ||= chunks.length > 0;
            index.externals.set(module.identifier, external);
        } else {
            let leaf = index.leaves.get(module.identifier);
            if (!leaf) {
                const named = nameOf(module);
                leaf = { ...named, identifier: module.identifier, id: uniqueId(named.id, module.moduleType, takenIds), module, chunks: new Set() };
                index.leaves.set(module.identifier, leaf);
            }
            chunks.forEach(chunk => leaf.chunks.add(chunk));
        }
        module.reasons.forEach(reason => index.reasons.push({ target: module.identifier, reason }));
    };
    for (const module of modules) {
        if (module.inner.length === 0) {
            visit(module, module.chunks);
            continue;
        }
        module.inner.forEach(inner => visit(inner, module.chunks));
        const root = rootOf(module);
        if (root) {
            index.roots.set(module.identifier, root.identifier);
            module.reasons.forEach(reason => index.reasons.push({ target: root.identifier, reason }));
        }
    }
    return index;
}

function useOf(type: string): ReasonUse {
    if (ENTRY_REASON.test(type)) {
        return 'entry';
    }
    if (IGNORED_REASON.test(type)) {
        return undefined;
    }
    return { kind: kindOf(type), perBinding: PER_BINDING_REASON.test(type) };
}

function kindOf(type: string): ImportKind {
    if (DYNAMIC_REASON.test(type)) {
        return 'dynamic';
    }
    if (REFERENCE_REASON.test(type)) {
        return 'reference';
    }
    if (CSS_REASON.test(type)) {
        return 'css';
    }
    return REQUIRE_REASON.test(type) ? 'require' : 'static';
}

function importerOf(origin: string | undefined, index: ModuleIndex): Leaf | undefined {
    return origin === undefined ? undefined : index.leaves.get(index.roots.get(origin) ?? origin);
}

function edgeTo(target: string, importer: string, kind: ImportKind, specifier: string | undefined, index: ModuleIndex): ImportEdge | undefined {
    const external = index.externals.get(target);
    if (external) {
        return { importer, specifier: specifier ?? external.request, kind, external: true, retained: external.retained };
    }
    const leaf = index.leaves.get(target);
    return leaf && { importer, ...(specifier === undefined ? {} : { specifier }), resolvedModule: leaf.id, kind, external: false };
}

function specifierKey(edge: ImportEdge): string {
    return `${edge.importer}\u0001${edge.specifier ?? ''}`;
}

function addImports(builder: SnapshotBuilder, index: ModuleIndex): ImportFacts {
    const entries = new Set<string>();
    const lazy = new Set<string>();
    const statements = new Set<string>();
    const perBinding: ImportEdge[] = [];
    for (const { target, reason } of index.reasons) {
        const use = useOf(reason.type);
        if (use === 'entry') {
            if (reason.origin === undefined) {
                entries.add(target);
            }
            continue;
        }
        const importer = importerOf(reason.origin, index);
        if (use === undefined || importer === undefined || importer.identifier === target) {
            continue;
        }
        const edge = edgeTo(target, importer.id, use.kind, reason.userRequest, index);
        if (!edge) {
            continue;
        }
        if (use.perBinding) {
            perBinding.push(edge);
            continue;
        }
        builder.edge(edge);
        statements.add(specifierKey(edge));
        if (use.kind === 'dynamic') {
            lazy.add(target);
        }
    }
    for (const edge of perBinding) {
        if (edge.specifier !== undefined && !statements.has(specifierKey(edge))) {
            builder.edge(edge);
        }
    }
    return { entries, lazy };
}

function sourceKindOf(type: string): ChunkKind | undefined {
    if (type.startsWith('css')) {
        return 'css';
    }
    return JS_SOURCE_TYPES.has(type) ? 'js' : undefined;
}

function weightOf(module: StatsModule, kind: ChunkKind): number {
    if (module.sizes.length === 0) {
        return (module.moduleType.startsWith('css') ? 'css' : 'js') === kind ? module.size : 0;
    }
    return module.sizes.reduce((sum, [type, size]) => (sourceKindOf(type) === kind ? sum + size : sum), 0);
}

function sourceKey(source: string, baseDir: string | undefined): string {
    const name = source.replace(WEBPACK_SOURCE, '');
    const { path } = splitQuery(name);
    if (path.startsWith('./') || path.startsWith('../')) {
        return normalizePath(path);
    }
    return isAbsolutePath(path) && baseDir !== undefined ? relativePath(baseDir, path) : name;
}

function sourcemapBytes(output: WebpackOutputFile, modules: readonly Weighted[], baseDir: string | undefined): Map<Leaf, number> {
    let totals: number[];
    try {
        totals = bytesPerSource(output.code, output.map);
    } catch {
        return new Map();
    }
    const bytesByKey = new Map<string, number>();
    output.map.sources.forEach((source, index) => {
        if (source !== null && source !== '') {
            const key = sourceKey(source, baseDir);
            bytesByKey.set(key, (bytesByKey.get(key) ?? 0) + (totals[index] ?? 0));
        }
    });
    const groups = new Map<string, Weighted[]>();
    for (const entry of modules) {
        if (bytesByKey.has(entry.leaf.path)) {
            push(groups, entry.leaf.path, entry);
        }
    }
    const result = new Map<Leaf, number>();
    for (const [key, group] of groups) {
        const shares = splitProportionally(bytesByKey.get(key) ?? 0, group.map(entry => entry.weight));
        group.forEach((entry, position) => result.set(entry.leaf, shares[position] ?? 0));
    }
    return result;
}

function estimateFile(bytes: number, modules: readonly Weighted[], output: WebpackOutputFile | undefined, baseDir: string | undefined): Map<Leaf, Estimate> {
    const estimates = new Map<Leaf, Estimate>();
    const mapped = output === undefined ? new Map<Leaf, number>() : sourcemapBytes(output, modules, baseDir);
    let mappedTotal = 0;
    for (const [leaf, mappedBytes] of mapped) {
        estimates.set(leaf, { bytes: mappedBytes, precision: 'sourcemap-estimate' });
        mappedTotal += mappedBytes;
    }
    const rest = modules.filter(entry => !mapped.has(entry.leaf));
    const weightTotal = rest.reduce((sum, entry) => sum + entry.weight, 0);
    const available = Math.max(0, bytes - mappedTotal);
    const factor = weightTotal > available && weightTotal > 0 ? available / weightTotal : 1;
    const precision: MeasurementPrecision = factor < 1 ? 'proportional-estimate' : 'rendered-length';
    for (const entry of rest) {
        estimates.set(entry.leaf, { bytes: entry.weight * factor, precision });
    }
    return estimates;
}

function leavesPerChunk(index: ModuleIndex): Map<ChunkKey, Leaf[]> {
    const result = new Map<ChunkKey, Leaf[]>();
    for (const leaf of index.leaves.values()) {
        for (const chunk of leaf.chunks) {
            push(result, chunk, leaf);
        }
    }
    return result;
}

function outputFilesOf(stats: Stats): OutputFiles {
    const sizes = new Map(stats.assets.map(asset => [asset.name, asset.bytes]));
    const chunks = new Map(stats.chunks.map(chunk => [chunk.key, chunk.files.filter(file => chunkKindOf(file) !== undefined && sizes.has(file))]));
    return { sizes, chunks, chunkFiles: new Set([...chunks.values()].flat()) };
}

function addChunks(builder: SnapshotBuilder, stats: Stats, leaves: ReadonlyMap<ChunkKey, readonly Leaf[]>, facts: ImportFacts, outputs: OutputFiles): void {
    const filesOf = (key: ChunkKey): readonly string[] => outputs.chunks.get(key) ?? [];
    const isLinkedAsset = (file: string): boolean => outputs.sizes.has(file) && !outputs.chunkFiles.has(file) && assetKindOf(file) !== 'sourcemap';
    for (const chunk of stats.chunks) {
        const files = filesOf(chunk.key);
        const members = leaves.get(chunk.key) ?? [];
        const entryModule = members.find(leaf => facts.entries.has(leaf.identifier))
            ?? (chunk.initial ? undefined : members.find(leaf => facts.lazy.has(leaf.identifier)));
        for (const file of files) {
            const script = chunkKindOf(file) === 'js';
            builder.chunk({
                id: file,
                kind: script ? 'js' : 'css',
                bytes: outputs.sizes.get(file) ?? 0,
                entry: chunk.initial,
                dynamicEntry: script && !chunk.initial && entryModule !== undefined,
                ...(script && entryModule !== undefined ? { entryModule: entryModule.id } : {}),
                imports: script ? chunk.siblings.flatMap(filesOf) : [],
                dynamicImports: script ? chunk.children.flatMap(key => filesOf(key).filter(each => chunkKindOf(each) === 'js')) : [],
                css: script ? files.filter(each => chunkKindOf(each) === 'css') : [],
                assets: script ? chunk.auxiliaryFiles.filter(isLinkedAsset) : [],
            });
        }
    }
}

function addContributions(builder: SnapshotBuilder, stats: Stats, leaves: ReadonlyMap<ChunkKey, readonly Leaf[]>, outputs: OutputFiles, details: WebpackBuildDetails): void {
    for (const chunk of stats.chunks) {
        const members = leaves.get(chunk.key) ?? [];
        for (const file of outputs.chunks.get(chunk.key) ?? []) {
            const kind = chunkKindOf(file) ?? 'js';
            const weighted = members.map(leaf => ({ leaf, weight: weightOf(leaf.module, kind) })).filter(entry => entry.weight > 0);
            for (const [leaf, estimate] of estimateFile(outputs.sizes.get(file) ?? 0, weighted, details.outputs?.get(file), details.baseDir)) {
                builder.contribute(leaf.id, file, estimate.bytes, estimate.precision);
            }
        }
    }
}

function addAssets(builder: SnapshotBuilder, stats: Stats, index: ModuleIndex, outputs: OutputFiles): void {
    const leavesByPath = new Map<string, Leaf[]>();
    for (const leaf of index.leaves.values()) {
        push(leavesByPath, leaf.path, leaf);
    }
    for (const asset of stats.assets) {
        if (outputs.chunkFiles.has(asset.name)) {
            continue;
        }
        builder.asset({ id: asset.name, kind: assetKindOf(asset.name), bytes: asset.bytes });
        const candidates = asset.sourceFilename === undefined ? [] : leavesByPath.get(normalizePath(asset.sourceFilename)) ?? [];
        const source = candidates.find(leaf => leaf.module.moduleType.startsWith('asset')) ?? candidates[0];
        if (source) {
            builder.contribute(source.id, asset.name, asset.bytes, 'bundler-reported');
        }
    }
}

const STATS_MARKERS: readonly ((value: Record<string, unknown>) => boolean)[] = [
    value => typeof value.rspackVersion === 'string',
    value => STATS_KEYS.some(key => Object.hasOwn(value, key)),
    value => Array.isArray(value.modules) && value.modules.some(module => isRecord(module) && typeof module.identifier === 'string'),
];

export function isWebpackStats(value: unknown): value is WebpackStats {
    return isRecord(value) && value.format === undefined && value.inputs === undefined && value.outputs === undefined
        && STATS_MARKERS.some(marker => marker(value));
}

export function normalizeWebpackStats(input: unknown, context: BuildContext, details: WebpackBuildDetails = {}): BuildSnapshot {
    const stats = readStats(input);
    const builder = new SnapshotBuilder();
    const index = indexModules(stats.modules);
    for (const leaf of index.leaves.values()) {
        builder.module(leaf.id, leaf.path, { virtual: leaf.virtual, sourceBytes: Math.round(leaf.module.size) });
    }

    const facts = addImports(builder, index);
    for (const identifier of facts.entries) {
        const leaf = index.leaves.get(identifier);
        if (leaf) {
            builder.markEntry(leaf.id);
        }
    }

    const outputs = outputFilesOf(stats);
    const leaves = leavesPerChunk(index);
    addChunks(builder, stats, leaves, facts, outputs);
    addContributions(builder, stats, leaves, outputs, details);
    addAssets(builder, stats, index, outputs);

    return builder.build({ bundler: stats.bundler, ...context });
}

export const webpackAdapter: BundlerAdapter<WebpackStats> = {
    name: 'webpack',
    supports: isWebpackStats,
    normalize: (input, context) => Promise.resolve(normalizeWebpackStats(input, context)),
};
