import path from 'node:path';

import { addPackageVersions, DEFAULT_OUT_DIR, describeError, PLUGIN_NAME, sanitizeTarget, snapshotRoot, writeSnapshot } from './shared';
import { normalizeEsbuildMetafile } from '../core/adapters/esbuild';

import type { BuildOptions, Plugin } from 'esbuild';

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

export function trueImportCost(options: TrueImportCostOptions = {}): Plugin {
    return {
        name: PLUGIN_NAME,

        setup(build) {
            build.initialOptions.metafile = true;
            const workingDir = path.resolve(build.initialOptions.absWorkingDir ?? process.cwd());
            const target = sanitizeTarget(options.target ?? defaultTarget(build.initialOptions));
            const file = path.resolve(workingDir, options.outDir ?? DEFAULT_OUT_DIR, options.fileName ?? `${target}.json`);
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
                    return undefined;
                } catch (error: unknown) {
                    return { warnings: [{ pluginName: PLUGIN_NAME, text: `Could not write the True Import Cost snapshot: ${describeError(error)}` }] };
                }
            });
        },
    };
}

export default trueImportCost;
