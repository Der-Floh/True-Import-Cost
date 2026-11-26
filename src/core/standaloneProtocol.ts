import type { BuildSnapshot } from './schema/snapshot';

export const STANDALONE_ENV = 'TRUE_IMPORT_COST_STANDALONE';

export const STANDALONE_VERSION = 1;

const MAX_NAMES = 100;

export type StandalonePlatform = 'browser' | 'node';

export type StandaloneNames = readonly string[] | 'all';

export interface StandaloneJob {
    readonly version: typeof STANDALONE_VERSION;
    readonly cwd: string;
    readonly specifier: string;
    readonly names: StandaloneNames;
    readonly platform: StandalonePlatform;
    readonly resultFile: string;
}

export interface StandaloneSize {
    readonly bytes: number;
    readonly gzipBytes: number;
}

export type StandaloneResult =
    | { readonly ok: true; readonly bundler: string; readonly whole: StandaloneSize; readonly imported?: StandaloneSize }
    | { readonly ok: false; readonly error: string };

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseSize(value: unknown): StandaloneSize | undefined {
    const size = typeof value === 'object' && value !== null ? value as Partial<Record<keyof StandaloneSize, unknown>> : {};
    return isCount(size.bytes) && isCount(size.gzipBytes) ? { bytes: size.bytes, gzipBytes: size.gzipBytes } : undefined;
}

export function parseStandaloneJob(value: unknown): StandaloneJob | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const job = value as Partial<Record<keyof StandaloneJob, unknown>>;
    const names = job.names === 'all' || (Array.isArray(job.names) && job.names.length <= MAX_NAMES && job.names.every(name => typeof name === 'string')) ? job.names : undefined;
    if (job.version !== STANDALONE_VERSION || typeof job.cwd !== 'string' || typeof job.specifier !== 'string' || job.specifier === '' || names === undefined
        || (job.platform !== 'browser' && job.platform !== 'node') || typeof job.resultFile !== 'string') {
        return undefined;
    }
    return { version: STANDALONE_VERSION, cwd: job.cwd, specifier: job.specifier, names, platform: job.platform, resultFile: job.resultFile };
}

export function parseStandaloneResult(value: unknown): StandaloneResult | undefined {
    const result = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
    if (result?.ok === false && typeof result.error === 'string') {
        return { ok: false, error: result.error.slice(0, 500) };
    }
    const whole = parseSize(result?.whole);
    const imported = result?.imported === undefined ? undefined : parseSize(result.imported);
    if (result?.ok !== true || typeof result.bundler !== 'string' || !whole || (result.imported !== undefined && !imported)) {
        return undefined;
    }
    return { ok: true, bundler: result.bundler.slice(0, 100), whole, ...(imported === undefined ? {} : { imported }) };
}

const NODE_RUNTIME_MODULES: ReadonlySet<string> = new Set([
    'assert', 'buffer', 'child_process', 'crypto', 'dns', 'events', 'fs', 'fs/promises', 'http', 'https', 'module', 'net', 'os',
    'path', 'process', 'readline', 'stream', 'timers', 'tls', 'url', 'util', 'worker_threads', 'zlib', 'vscode',
]);

export function platformOf(snapshot: BuildSnapshot): StandalonePlatform {
    if (snapshot.bundler.name === 'vite') {
        return 'browser';
    }
    const runsOnNode = snapshot.imports.some(edge => edge.external && edge.specifier !== undefined
        && (edge.specifier.startsWith('node:') || NODE_RUNTIME_MODULES.has(edge.specifier)));
    return runsOnNode ? 'node' : 'browser';
}
