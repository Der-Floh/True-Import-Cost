import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readMeasureRequest, SourceEdits, writeMeasureReport } from './measure';
import { addPackageVersions, DEFAULT_OUT_DIR, describeError, PLUGIN_NAME, sanitizeTarget, snapshotRoot, writeSnapshot } from './shared';
import { normalizeEsbuildMetafile } from '../core/adapters/esbuild';

import type { BuildOptions, Loader, Plugin, PluginBuild } from 'esbuild';

export interface TrueImportCostOptions {
    /** Name of the build target, such as `extension-host`. Defaults to the output file's name. */
    readonly target?: string;
    /** Directory the snapshot is written to, relative to esbuild's working directory. Defaults to `.true-import-cost`. */
    readonly outDir?: string;
    /** File name of the snapshot. Defaults to `<target>.json`. */
    readonly fileName?: string;
    /** Whether the build is a production build. Defaults to `production` when `minify` is on. */
    readonly mode?: 'production' | 'development';
}

function defaultTarget(options: BuildOptions): string {
    if (options.outfile !== undefined) {
        return path.basename(options.outfile).replace(/\.[^.]+$/, '');
    }
    const entryPoints = options.entryPoints;
    const first = Array.isArray(entryPoints) ? entryPoints[0] : entryPoints === undefined ? undefined : Object.keys(entryPoints)[0];
    const entry = typeof first === 'string' ? first : first?.in;
    return entry === undefined ? 'esbuild' : path.basename(entry).replace(/\.[^.]+$/, '');
}

const LOADERS: Readonly<Record<string, Loader>> = {
    '.ts': 'ts',
    '.mts': 'ts',
    '.cts': 'ts',
    '.tsx': 'tsx',
    '.js': 'js',
    '.mjs': 'js',
    '.cjs': 'js',
    '.jsx': 'jsx',
};

function loaderFor(file: string, configured: BuildOptions['loader']): Loader | undefined {
    const extension = path.extname(file).toLowerCase();
    return configured?.[extension] ?? LOADERS[extension];
}

function loadEdited(build: PluginBuild, edits: SourceEdits): void {
    build.onLoad({ filter: edits.filter(), namespace: 'file' }, async (args) => {
        const loader = loaderFor(args.path, build.initialOptions.loader);
        if (!edits.has(args.path) || loader === undefined) {
            return undefined;
        }
        return { contents: edits.apply(args.path, await readFile(args.path, 'utf8')), loader };
    });
}

export function trueImportCost(options: TrueImportCostOptions = {}): Plugin {
    const request = readMeasureRequest();
    const edits = request === undefined ? undefined : new SourceEdits(request.edits);

    return {
        name: PLUGIN_NAME,

        setup(build) {
            build.initialOptions.metafile = true;
            if (request !== undefined) {
                build.initialOptions.write = false;
            }
            if (edits !== undefined && edits.size > 0) {
                loadEdited(build, edits);
            }
            const workingDir = path.resolve(build.initialOptions.absWorkingDir ?? process.cwd());
            const target = sanitizeTarget(options.target ?? defaultTarget(build.initialOptions));
            const directory = request?.outDir ?? path.resolve(workingDir, options.outDir ?? DEFAULT_OUT_DIR);
            const file = path.resolve(directory, options.fileName ?? `${target}.json`);
            const version = (build as { esbuild?: { version?: string } }).esbuild?.version;

            build.onEnd(async (result) => {
                if (result.errors.length > 0 || !result.metafile) {
                    return undefined;
                }
                try {
                    const snapshot = normalizeEsbuildMetafile(result.metafile, {
                        target,
                        createdAt: Date.now(),
                        root: snapshotRoot(file, workingDir),
                        bundler: version === undefined ? { name: 'esbuild' } : { name: 'esbuild', version },
                        mode: options.mode ?? (build.initialOptions.minify === true ? 'production' : 'development'),
                    });
                    await writeSnapshot(file, await addPackageVersions(snapshot, workingDir));
                    if (edits !== undefined) {
                        await writeMeasureReport(file, edits.report(target));
                    }
                    return undefined;
                } catch (error: unknown) {
                    return { warnings: [{ pluginName: PLUGIN_NAME, text: `Could not write the True Import Cost snapshot: ${describeError(error)}` }] };
                }
            });
        },
    };
}

export default trueImportCost;
