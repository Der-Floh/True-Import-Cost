# Writing a plugin for another bundler

The True Import Cost extension never loads code from a workspace or from anyone else, so a bundler cannot plug code into it. A bundler takes part by writing a [build snapshot](snapshot-schema.md) after every build, where the extension and the CLI find it. `@true-import-cost/snapshot` is the package the plugins for esbuild, Vite, webpack and Rspack are built on: it builds, checks and writes snapshots, and takes part in measuring an import. This guide uses it to write a plugin for any other bundler.

A plugin written in another language writes the same file: the [format](snapshot-schema.md), its [JSON Schema](snapshot-schema.md#json-schema) and the [measurement files](#measurement-mode) are all it needs.

## Install

```bash
npm install @true-import-cost/snapshot
```

The package has no dependencies and runs on Node.js 18 and later. Its format is stable within [schema version 1](snapshot-schema.md#stability).

## What a plugin does

After every successful build, a plugin describes the build with a `SnapshotBuilder`, fills in the versions of the bundled packages, and writes the snapshot to `.true-import-cost/<target>.json`. After a failed build it writes nothing, and the extension keeps the last snapshot.

Every module path in a snapshot is relative to one directory, normally the bundler's root or working directory, and uses forward slashes: `toPosix(path.relative(root, file))`. The snapshot's `root` says where that directory is, relative to the folder of the snapshot file: `snapshotRoot(snapshotFile, root)`.

## Modules and what they contribute

`builder.module(id, path, options)` adds a module. The id is unique within the build: usually the path, plus the query of a virtual sub-module such as `App.vue?vue&type=style&index=0&lang.css`. The path is the file it comes from, without the query. A module under `node_modules` gets its package name and install root from its path. Set `virtual: true` for a module that has no file of its own, such as a bundler's runtime helper, and `sourceBytes` to its size before the build. Mark each entry point with `builder.markEntry(id)`.

`builder.contribute(moduleId, outputId, bytes, precision)` records how many bytes of an output file come from a module. Calls for the same module and file add up, and keep the least precise of their precisions. A module that contributes nothing was left out of the output, for instance by tree shaking, and True Import Cost shows it as such.

The precision says how the bytes were measured. The hover shows it, so choose it honestly ([measurements.md](measurements.md#precision) defines each value):

| What the bundler tells you | Precision |
| --- | --- |
| The bytes each module takes in the file as written, like esbuild's `bytesInOutput`, or the size of a file emitted for one module, such as an image | `bundler-reported` |
| Bytes per module that you attribute through the file's source map | `sourcemap-estimate` |
| Each module's size before minification, for a file that is not minified | `rendered-length` |
| Sizes before minification, scaled down so that they add up to the minified file | `proportional-estimate` |

Sizes measured before minification are never `bundler-reported`. When they add up to more than the file, scale them to the file and call them `proportional-estimate`.

## Chunks and assets

JavaScript and CSS files are chunks, every other output file is an asset. `chunkKindOf(fileName)` returns `js`, `css` or, for an asset, `undefined`, and `assetKindOf(fileName)` names the kind of an asset. Outputs are named by their path relative to the output directory, with forward slashes, and a chunk refers to other outputs by those names.

```ts
builder.chunk({
    id: 'assets/index-DDhTxJY7.js',
    kind: 'js',
    bytes: 65_997,
    entry: true,
    entryModule: 'src/main.ts',
    imports: ['assets/vendor-B2x9.js'],
    dynamicImports: ['assets/Settings-n-ewKlwO.js'],
    css: ['assets/index-msnPlxbd.css'],
    assets: ['assets/logo-3f2a.svg'],
});
builder.asset({ id: 'assets/logo-3f2a.svg', kind: 'image', bytes: 2_048 });
```

| Field | Meaning |
| --- | --- |
| `entry` | The chunk is an entry point of the build, loaded when the page or program starts |
| `dynamicEntry` | The chunk is loaded on demand, by a dynamic `import()` |
| `entryModule` | The module the chunk was built for: its entry point, or the module the `import()` loads |
| `imports` | Chunks it loads before it runs. With `entry`, they decide what loads initially |
| `dynamicImports` | Chunks it loads with `import()` |
| `css`, `assets` | Stylesheets and other files it loads |

Everything but `id`, `kind` and `bytes` may be left out: flags default to `false` and lists to empty.

## Imports

`builder.edge(edge)` adds an import of one module by another. Give the specifier as it is written in the source whenever the bundler knows it: it is the first thing the extension [matches the imports of the open document](architecture.md#matching-an-import-to-the-build) by.

| `kind` | Import |
| --- | --- |
| `static` | `import` and `export … from` statements |
| `dynamic` | `import()` |
| `require` | `require()` |
| `css` | `@import` and `composes` in stylesheets |
| `reference` | A file referred to by URL rather than run, like `new URL('./worker.js', import.meta.url)`, `require.resolve()` or `url()` in CSS. Its bytes do not count toward the import |

An import the bundler resolved names the module in `resolvedModule` and has `external: false`. An import it left external has a `specifier`, no `resolvedModule` and `external: true`, and `retained` says whether the output still imports it: `false` when the bundler dropped the import because nothing used it. Leave `retained` out when the bundler cannot tell.

## Package versions, target and file

- `withPackageVersions(snapshot, read)` calls `read(packageRoot)` once for each install root, with the root relative to the module paths, and fills in the version it returns. A reader that throws or returns nothing leaves that package without a version.
- The target names the build, such as `webview` or `extension-host`. The extension keeps targets apart, and measuring an import looks for its target by name. Let users choose it, default to something stable such as the name of the root directory, and pass it through `sanitizeTarget()` before you use it in a file name.
- `builder.build(context)` returns the snapshot, with the `target`, the time the build finished as `createdAt` (`Date.now()`), the `root`, the `bundler` (`name`, `version`, and the `engine` underneath, if any) and the `mode`, `production` or `development`.
- `writeSnapshot(file, snapshot)` writes the file atomically and creates its folder. A folder named `.true-import-cost` (`DEFAULT_OUT_DIR`) that it creates gets a `.gitignore`, since a snapshot describes one machine's build. Write to `<root>/.true-import-cost/<target>.json` unless the user chooses another place.

## Testing the output

`parseSnapshot` is the check the extension and the CLI run on every file they read: the shape, the limits, and that every module and output named anywhere exists. Run it in your plugin's tests:

```ts
import { readFileSync } from 'node:fs';
import { parseSnapshot } from '@true-import-cost/snapshot';

const result = parseSnapshot(JSON.parse(readFileSync('.true-import-cost/web.json', 'utf8')));
if (!result.ok) {
    throw new Error(result.error);
}
```

Then read it with the CLI, which prints the sizes of the build, what loads initially and lazily, and the largest packages with their versions: `npx @true-import-cost/cli summary .true-import-cost/web.json`.

## Measurement mode

To measure what an import costs, True Import Cost runs the build twice with the environment variable `TRUE_IMPORT_COST_MEASURE` set: once as it is and once with the import taken out of the source. The variable names a request file. While it is set, a plugin:

1. Reads the request: `readMeasureRequest()` returns `undefined` when the variable is not set, and throws when the request cannot be read or validated. Let that fail the build.
2. Applies the edits while the bundler loads source files: create `new SourceEdits(request.edits)`, and pass the text of every file the bundler reads from disk through `edits.apply(file, text)`. `edits.has(file)` tells whether a file has edits, and `edits.filter()` is a regular expression for the hooks of bundlers that filter by file name. `apply` throws when a file no longer contains the text an edit replaces; let that fail the build too. The file on disk stays as it is.
3. Never writes the bundle output: turn writing off. If another plugin can turn it back on, check before anything is written and fail the build rather than write.
4. Writes the snapshot to the folder `request.outDir`, under the same target name, instead of the `.true-import-cost` folder.
5. Then writes the report: `writeMeasureReport(snapshotFile, edits.report(target))` writes `<target>.edits.json` next to the snapshot, listing the files the plugin edited and those it never loaded. A measurement whose edits were not applied is discarded.

A plugin in another language reads the request itself. It is JSON:

```json
{
    "version": 1,
    "outDir": "/home/me/.config/Code/User/workspaceStorage/1f0e/florian-noever.true-import-cost/measure/5b1e9a62/without",
    "edits": [
        { "file": "/home/me/app/src/main.ts", "start": 0, "end": 31, "expected": "import { chart } from 'charts';", "replacement": "const chart = void 0;" }
    ]
}
```

Paths are absolute. `start` and `end` are offsets in UTF-16 code units, JavaScript string indices, into the text of the file without a byte order mark; `expected` is the text between them, and the replacement takes its place. Several edits of one file never overlap, and all their offsets refer to the file as it is on disk. The report is `{ "version": 1, "target": "web", "applied": ["/home/me/app/src/main.ts"], "missing": [] }`, written next to the snapshot with `.json` replaced by `.edits.json`.

## A complete example

Spindle is a bundler made up for this guide. Its plugin API reports each module with its imports, and each output file with the size before minification of every module in it:

```ts spindle.d.ts
export interface SpindleImport {
    readonly specifier: string;
    readonly kind: 'import' | 'dynamic-import' | 'require' | 'css-import' | 'url';
    /** Absolute path of the module the import resolved to; absent when the import is external. */
    readonly resolved?: string;
}

export interface SpindleModule {
    /** Absolute path. */
    readonly file: string;
    readonly size: number;
    readonly imports: readonly SpindleImport[];
}

export interface SpindleOutput {
    /** Path relative to the output directory, with forward slashes. */
    readonly fileName: string;
    readonly size: number;
    /** Absolute path of the module the file was built for: an entry point, or the target of a dynamic import. */
    readonly entry?: string;
    readonly isDynamicEntry: boolean;
    /** Output files it loads up front, and on demand. */
    readonly imports: readonly string[];
    readonly dynamicImports: readonly string[];
    /** Bytes of each module in the file, by absolute path, before minification. A file emitted for one module, such as an image, lists that module with the size of the file. */
    readonly modules: Readonly<Record<string, number>>;
    /** External specifiers the file still imports. */
    readonly externals: readonly string[];
}

export interface SpindleResult {
    readonly errors: readonly string[];
    readonly modules: readonly SpindleModule[];
    readonly outputs: readonly SpindleOutput[];
}

export interface SpindleBuild {
    readonly version: string;
    readonly options: { readonly root: string; readonly minify: boolean; write: boolean };
    /** Replaces the text of the files the filter matches, when the load function returns some. */
    onLoad(filter: RegExp, load: (file: string) => Promise<string | undefined>): void;
    onEnd(callback: (result: SpindleResult) => Promise<void>): void;
    warn(message: string): void;
}

export interface SpindlePlugin {
    readonly name: string;
    setup(build: SpindleBuild): void;
}
```

The plugin:

```ts true-import-cost-spindle.ts
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
    assetKindOf, chunkKindOf, DEFAULT_OUT_DIR, readMeasureRequest, sanitizeTarget, SnapshotBuilder, snapshotRoot,
    SourceEdits, toPosix, withPackageVersions, writeMeasureReport, writeSnapshot,
} from '@true-import-cost/snapshot';

import type { BuildSnapshot, ImportKind, MeasurementPrecision } from '@true-import-cost/snapshot';
import type { SpindleImport, SpindleOutput, SpindlePlugin, SpindleResult } from 'spindle';

export interface TrueImportCostOptions {
    /** Name of the build target. Defaults to the name of Spindle's root directory. */
    readonly target?: string;
}

const IMPORT_KINDS: Readonly<Record<SpindleImport['kind'], ImportKind>> = {
    'import': 'static',
    'dynamic-import': 'dynamic',
    'require': 'require',
    'css-import': 'css',
    'url': 'reference',
};

function addOutput(builder: SnapshotBuilder, output: SpindleOutput, idOf: (file: string) => string): void {
    const kind = chunkKindOf(output.fileName);
    const modules = Object.entries(output.modules);
    if (kind === undefined) {
        builder.asset({ id: output.fileName, kind: assetKindOf(output.fileName), bytes: output.size });
        modules.forEach(([file, bytes]) => builder.contribute(idOf(file), output.fileName, bytes, 'bundler-reported'));
        return;
    }
    const rendered = modules.reduce((sum, [, bytes]) => sum + bytes, 0);
    const scale = rendered > output.size ? output.size / rendered : 1;
    const precision: MeasurementPrecision = scale < 1 ? 'proportional-estimate' : 'rendered-length';
    modules.forEach(([file, bytes]) => builder.contribute(idOf(file), output.fileName, bytes * scale, precision));
    builder.chunk({
        id: output.fileName,
        kind,
        bytes: output.size,
        entry: output.entry !== undefined && !output.isDynamicEntry,
        dynamicEntry: output.isDynamicEntry,
        ...(output.entry === undefined ? {} : { entryModule: idOf(output.entry) }),
        imports: output.imports.filter(name => chunkKindOf(name) === 'js'),
        dynamicImports: output.dynamicImports,
        css: output.imports.filter(name => chunkKindOf(name) === 'css'),
        assets: output.imports.filter(name => chunkKindOf(name) === undefined),
    });
}

function describeBuild(result: SpindleResult, root: string): SnapshotBuilder {
    const builder = new SnapshotBuilder();
    const idOf = (file: string): string => toPosix(path.relative(root, file));
    const retained = new Set(result.outputs.flatMap(output => output.externals));
    for (const module of result.modules) {
        builder.module(idOf(module.file), idOf(module.file), { sourceBytes: module.size });
    }
    for (const module of result.modules) {
        for (const { specifier, kind, resolved } of module.imports) {
            builder.edge(resolved === undefined
                ? { importer: idOf(module.file), specifier, kind: IMPORT_KINDS[kind], external: true, retained: retained.has(specifier) }
                : { importer: idOf(module.file), specifier, resolvedModule: idOf(resolved), kind: IMPORT_KINDS[kind], external: false });
        }
    }
    for (const output of result.outputs) {
        if (output.entry !== undefined && !output.isDynamicEntry) {
            builder.markEntry(idOf(output.entry));
        }
        addOutput(builder, output, idOf);
    }
    return builder;
}

function readVersion(root: string, packageRoot: string): string | undefined {
    const manifest = JSON.parse(readFileSync(path.join(root, packageRoot, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : undefined;
}

export function trueImportCost(options: TrueImportCostOptions = {}): SpindlePlugin {
    const request = readMeasureRequest();
    const edits = request === undefined ? undefined : new SourceEdits(request.edits);
    return {
        name: 'true-import-cost',
        setup(build) {
            const root = path.resolve(build.options.root);
            const target = sanitizeTarget(options.target ?? path.basename(root));
            const file = path.join(request?.outDir ?? path.join(root, DEFAULT_OUT_DIR), `${target}.json`);
            if (request !== undefined) {
                build.options.write = false;
            }
            if (edits !== undefined && edits.size > 0) {
                build.onLoad(edits.filter(), async source => (edits.has(source) ? edits.apply(source, await readFile(source, 'utf8')) : undefined));
            }
            build.onEnd(async (result) => {
                if (result.errors.length > 0) {
                    return;
                }
                try {
                    const snapshot: BuildSnapshot = describeBuild(result, root).build({
                        target,
                        createdAt: Date.now(),
                        root: snapshotRoot(file, root),
                        bundler: { name: 'spindle', version: build.version },
                        mode: build.options.minify ? 'production' : 'development',
                    });
                    await writeSnapshot(file, await withPackageVersions(snapshot, packageRoot => readVersion(root, packageRoot)));
                    if (edits !== undefined) {
                        await writeMeasureReport(file, edits.report(target));
                    }
                } catch (error: unknown) {
                    build.warn(`Could not write the True Import Cost snapshot: ${error instanceof Error ? error.message : String(error)}`);
                }
            });
        },
    };
}
```

A user adds it like any Spindle plugin, and the extension shows the costs of their imports after the next build.

## Checklist

- Every module path is relative to one root and uses forward slashes, and the snapshot's `root` points at that directory.
- Each contribution's precision matches how the bundler measured it.
- A chunk names other outputs by the ids the snapshot gives them.
- The plugin writes no snapshot after a failed build.
- `parseSnapshot` accepts every snapshot the plugin writes, and the CLI reads it.
- While measuring, the plugin applies the edits to everything it loads, writes no build output, and writes the snapshot and the report to `request.outDir`.
