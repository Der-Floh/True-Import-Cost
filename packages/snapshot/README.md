# @true-import-cost/snapshot

Build, check and write the build snapshots that the [True Import Cost](https://github.com/Der-Floh/True-Import-Cost) VS Code extension and CLI read, from a plugin for any bundler.

True Import Cost shows the cost of every import inline in the editor, measured from your real build output. The extension never loads code from a workspace or from a plugin, so a bundler takes part by writing a snapshot of each build: its modules, what each contributes to each output file, its chunks and assets, and its import graph. This package is what the True Import Cost plugins for esbuild, Vite, webpack and Rspack are built on. [Writing a plugin for another bundler](https://github.com/Der-Floh/True-Import-Cost/blob/main/docs/writing-a-plugin.md) walks through a complete plugin, and [the snapshot format](https://github.com/Der-Floh/True-Import-Cost/blob/main/docs/snapshot-schema.md) describes every field.

## Install

```bash
npm install @true-import-cost/snapshot
```

It has no dependencies and runs on Node.js 18 and later.

## Use

```ts
import path from 'node:path';
import { DEFAULT_OUT_DIR, SnapshotBuilder, snapshotRoot, writeSnapshot } from '@true-import-cost/snapshot';

const root = process.cwd();
const file = path.join(root, DEFAULT_OUT_DIR, 'web.json');

const builder = new SnapshotBuilder();
builder.module('src/main.ts', 'src/main.ts');
builder.module('node_modules/ms/index.js', 'node_modules/ms/index.js');
builder.markEntry('src/main.ts');
builder.edge({ importer: 'src/main.ts', specifier: 'ms', resolvedModule: 'node_modules/ms/index.js', kind: 'static', external: false });
builder.chunk({ id: 'main.js', kind: 'js', bytes: 1_250, entry: true, entryModule: 'src/main.ts' });
builder.contribute('src/main.ts', 'main.js', 400, 'bundler-reported');
builder.contribute('node_modules/ms/index.js', 'main.js', 850, 'bundler-reported');

await writeSnapshot(file, builder.build({
    target: 'web',
    createdAt: Date.now(),
    root: snapshotRoot(file, root),
    bundler: { name: 'my-bundler', version: '1.0.0' },
    mode: 'production',
}));
```

## Building a snapshot

| Export | What it does |
| --- | --- |
| `SnapshotBuilder` | Collects a build and returns its snapshot |
| `builder.module(id, path, options?)` | Adds a module, with `ModuleOptions`: `virtual` for a module without a file of its own, and its `sourceBytes`. A module under `node_modules` gets its package from its path. Adding a module again only fills in its source size |
| `builder.markEntry(id)` | Marks a module as an entry point of the build |
| `builder.contribute(moduleId, outputId, bytes, precision)` | Records the bytes of an output file that come from a module, and how they were measured. Contributions to the same file add up and keep the least precise measurement; zero bytes, and modules the builder does not have, are ignored |
| `builder.edge(edge)` | Adds an `ImportEdge`: an import resolved to a module, or an external one. An identical edge is kept once |
| `builder.chunk(chunk)` | Adds a JavaScript or CSS output file. A `ChunkInput` needs `id`, `kind` and `bytes`; the flags default to `false` and the lists of what it loads to none |
| `builder.asset(asset)` | Adds another output file, as an `AssetRecord` |
| `builder.hasModule(id)`, `builder.hasOutput(id)` | Whether the builder has a module, or a chunk or asset, of that id |
| `builder.build(context)` | Returns the `BuildSnapshot`. The `BuildContext` gives the `target`, the time the build finished as `createdAt`, the `root` module paths are relative to, the `bundler`, the `mode`, and optionally an `id` |
| `withPackageVersions(snapshot, read)` | Returns the snapshot with the version of every package filled in. A `PackageVersionReader` gets each install root once, relative to the module paths, and returns its version; when it throws or returns nothing, that package keeps no version |
| `writeSnapshot(file, snapshot)` | Writes the snapshot atomically, creating its folder. A `.true-import-cost` folder it creates gets a `.gitignore` |
| `DEFAULT_OUT_DIR` | `.true-import-cost`, the folder the extension looks for snapshots in |
| `sanitizeTarget(name)` | Makes a target name safe to use as a file name |
| `snapshotRoot(snapshotFile, root)` | The `root` of a snapshot: the directory of the module paths, relative to the snapshot file's folder |
| `toPosix(path)` | Turns a path into one with forward slashes, as module paths are written |
| `chunkKindOf(fileName)` | `js` or `css` for a chunk, `undefined` for any other output file |
| `assetKindOf(fileName)` | The `AssetKind` of an output file that is not a chunk |

## Checking a snapshot

`parseSnapshot(value)` is the check the extension and the CLI run on every file they read. It returns a `SnapshotParseResult`: `{ ok: true, snapshot }`, without any field the format does not have, or `{ ok: false, error }` with a short message, for a value of the wrong shape, beyond the limits, with references between modules, chunks, assets and imports that do not resolve, or of another schema version. Run it on what your plugin writes in its tests.

For tools in other languages, the package carries the format as a JSON Schema (draft 2020-12), `@true-import-cost/snapshot/build-snapshot.schema.json`, also published at `https://raw.githubusercontent.com/Der-Floh/True-Import-Cost/main/packages/snapshot/build-snapshot.schema.json`. It checks the shape and the limits; only `parseSnapshot` also checks that references resolve.

## The format

`SNAPSHOT_FORMAT` and `SNAPSHOT_SCHEMA_VERSION` are the values of the snapshot's `format` and `schemaVersion`. The types of the format are `BuildSnapshot`, `BundlerInfo`, `BuildMode`, `ModuleRecord`, `ModuleContribution`, `MeasurementPrecision`, `ChunkRecord`, `ChunkKind`, `AssetRecord`, `AssetKind`, `ImportEdge` and `ImportKind`.

The precision of a contribution says how its bytes were measured, and the extension shows it: `bundler-reported` for bytes the bundler reports for the file as written, `sourcemap-estimate` for bytes attributed through a source map, `rendered-length` for sizes before minification in a file that is not minified, and `proportional-estimate` for such sizes scaled to a minified file.

## Measuring an import

To measure what an import costs, True Import Cost runs the build with the environment variable named by `MEASURE_ENV`, `TRUE_IMPORT_COST_MEASURE`, set to a request file, and with the import taken out of the source. While it is set, a plugin applies the edits, writes no build output, and writes its snapshot and a report to the folder the request names.

| Export | What it does |
| --- | --- |
| `readMeasureRequest(env?)` | Returns the `MeasureRequest`, with its `outDir` and its `SourceEdit` list, or `undefined` when the build is not measured. Throws when the request cannot be read or validated |
| `SourceEdits` | `new SourceEdits(request.edits)` holds the edits. `apply(file, text)` returns the text with the edits of that file applied, and throws when the file changed since the measurement was planned; `has(file)`, `size` and `filter()`, a regular expression for file names, help a plugin load only the files with edits; `report(target)` returns the `MeasureReport` |
| `writeMeasureReport(snapshotFile, report)` | Writes the report next to the snapshot, as `<name>.edits.json` |

## Stability

The snapshot format is stable within schema version 1: new versions of this package may add optional fields and exports, and a new schema version comes with a new major version. See [Stability](https://github.com/Der-Floh/True-Import-Cost/blob/main/docs/snapshot-schema.md#stability).

## License

MIT
