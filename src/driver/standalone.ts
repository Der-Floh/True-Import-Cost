import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import type { StandaloneJob, StandaloneNames, StandaloneResult, StandaloneSize } from '../core/standaloneProtocol';

interface Bundler {
    readonly name: string;
    bundle(entry: string, job: StandaloneJob): Promise<readonly Uint8Array[]>;
}

interface EsbuildLike {
    readonly version: string;
    build(options: Record<string, unknown>): Promise<{ readonly outputFiles?: readonly { readonly contents: Uint8Array }[] }>;
}

interface RolldownBuild {
    generate(options: Record<string, unknown>): Promise<{ readonly output: readonly { readonly type: string; readonly code?: string }[] }>;
    close(): Promise<void>;
}

interface RolldownLike {
    readonly VERSION?: string;
    rolldown(options: Record<string, unknown>): Promise<RolldownBuild>;
}

const ENTRY_ID = '\0true-import-cost-standalone-entry';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const NODE_BUILTINS = [...builtinModules, ...builtinModules.map(name => `node:${name}`)];

function isNameList(names: StandaloneNames): names is readonly string[] {
    return names !== 'all' && names.length > 0 && names.every(name => name === 'default' || IDENTIFIER.test(name));
}

export function entrySource(specifier: string, names: StandaloneNames): string {
    const quoted = JSON.stringify(specifier);
    return isNameList(names)
        ? `export { ${[...new Set(names)].join(', ')} } from ${quoted};\n`
        : `import * as everything from ${quoted};\nexport default everything;\n`;
}

function resolveFrom(request: string, directories: readonly string[]): string | undefined {
    for (const directory of directories) {
        try {
            return createRequire(path.join(directory, 'noop.js')).resolve(request);
        } catch {
            continue;
        }
    }
    return undefined;
}

function searchDirectories(cwd: string): string[] {
    const vite = resolveFrom('vite/package.json', [cwd]);
    return vite === undefined ? [cwd] : [cwd, path.dirname(vite)];
}

function load<T>(main: string, cwd: string): T {
    return createRequire(path.join(cwd, 'noop.js'))(main) as T;
}

function esbuildBundler(main: string, cwd: string): Bundler {
    const esbuild = load<EsbuildLike>(main, cwd);
    return {
        name: `esbuild ${esbuild.version}`,
        async bundle(entry, job) {
            const result = await esbuild.build({
                stdin: { contents: entry, resolveDir: job.cwd, sourcefile: 'standalone-entry.js', loader: 'js' },
                absWorkingDir: job.cwd,
                bundle: true,
                minify: true,
                write: false,
                format: 'esm',
                platform: job.platform,
                external: job.platform === 'browser' ? NODE_BUILTINS : [],
                legalComments: 'none',
                logLevel: 'silent',
            });
            return (result.outputFiles ?? []).map(file => file.contents);
        },
    };
}

function rolldownBundler(main: string, cwd: string): Bundler {
    const rolldown = load<RolldownLike>(main, cwd);
    return {
        name: rolldown.VERSION === undefined ? 'rolldown' : `rolldown ${rolldown.VERSION}`,
        async bundle(entry, job) {
            const build = await rolldown.rolldown({
                input: ENTRY_ID,
                cwd: job.cwd,
                platform: job.platform,
                logLevel: 'silent',
                external: job.platform === 'browser' ? NODE_BUILTINS : [],
                plugins: [{
                    name: 'true-import-cost-standalone',
                    resolveId: (id: string) => (id === ENTRY_ID ? id : null),
                    load: (id: string) => (id === ENTRY_ID ? entry : null),
                }],
            });
            try {
                const { output } = await build.generate({ format: 'esm', minify: true });
                return output.flatMap(item => (item.type === 'chunk' && item.code !== undefined ? [new TextEncoder().encode(item.code)] : []));
            } finally {
                await build.close();
            }
        },
    };
}

export type BundlerName = 'esbuild' | 'rolldown';

const FACTORIES: Readonly<Record<BundlerName, (main: string, cwd: string) => Bundler>> = {
    esbuild: esbuildBundler,
    rolldown: rolldownBundler,
};

export function findBundler(cwd: string, order: readonly BundlerName[] = ['esbuild', 'rolldown']): Bundler | undefined {
    const directories = searchDirectories(cwd);
    for (const name of order) {
        const main = resolveFrom(name, directories);
        if (main !== undefined) {
            return FACTORIES[name](main, cwd);
        }
    }
    return undefined;
}

function firstLine(error: unknown): string {
    const reported = (error as { readonly errors?: readonly { readonly text?: unknown }[] } | null)?.errors?.find(item => typeof item.text === 'string')?.text;
    const text = typeof reported === 'string' ? reported : error instanceof Error ? error.message : String(error);
    return text.split('\n').find(line => line.trim() !== '')?.trim().slice(0, 500) ?? 'the bundler failed';
}

async function sizeOf(bundler: Bundler, job: StandaloneJob, names: StandaloneNames): Promise<StandaloneSize> {
    const files = await bundler.bundle(entrySource(job.specifier, names), job);
    return {
        bytes: files.reduce((sum, file) => sum + file.byteLength, 0),
        gzipBytes: files.reduce((sum, file) => sum + gzipSync(file, { level: 9 }).byteLength, 0),
    };
}

export async function measureStandalone(job: StandaloneJob, order?: readonly BundlerName[]): Promise<StandaloneResult> {
    const bundler = findBundler(job.cwd, order);
    if (!bundler) {
        return { ok: false, error: 'neither esbuild nor Rolldown is installed in this project' };
    }
    try {
        const whole = await sizeOf(bundler, job, 'all');
        const imported = isNameList(job.names) ? await sizeOf(bundler, job, job.names) : undefined;
        return { ok: true, bundler: bundler.name, whole, ...(imported === undefined ? {} : { imported }) };
    } catch (error: unknown) {
        return { ok: false, error: firstLine(error) };
    }
}
