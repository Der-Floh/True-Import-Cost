# Snapshot format

A True Import Cost snapshot is one JSON file per build target, normally in a `.true-import-cost` folder. The bundler plugins write it, and so can a plugin for any other bundler: [writing-a-plugin.md](writing-a-plugin.md) shows how, with the `@true-import-cost/snapshot` package. The extension and the CLI also accept a raw esbuild metafile or webpack and Rspack stats, and convert them to this format on read. The TypeScript definition is `src/core/schema/snapshot.ts`, the validation `src/core/schema/validate.ts`; `@true-import-cost/snapshot` publishes both, with a [JSON Schema](#json-schema).

```jsonc
{
    "format": "true-import-cost/build-snapshot",
    "schemaVersion": 1,
    "id": "webview@1764150000000",
    "target": "webview",
    "createdAt": 1764150000000,
    "bundler": { "name": "vite", "version": "8.3.8", "engine": "rolldown 1.2.19" },
    "mode": "production",
    "root": "..",
    "modules": [
        {
            "id": "node_modules/big-library/lib/parse.js",
            "path": "node_modules/big-library/lib/parse.js",
            "packageName": "big-library",
            "packageVersion": "3.2.0",
            "packageRoot": "node_modules/big-library",
            "contributions": [
                { "chunkId": "assets/index-DDhTxJY7.js", "bytes": 89, "precision": "proportional-estimate" }
            ]
        }
    ],
    "chunks": [
        {
            "id": "assets/index-DDhTxJY7.js",
            "kind": "js",
            "bytes": 65997,
            "entry": true,
            "dynamicEntry": false,
            "entryModule": "index.html",
            "imports": [],
            "dynamicImports": ["assets/Lazy-n-ewKlwO.js"],
            "css": ["assets/index-msnPlxbd.css"],
            "assets": []
        }
    ],
    "assets": [
        { "id": "index.html", "kind": "html", "bytes": 327 }
    ],
    "imports": [
        { "importer": "src/main.ts", "resolvedModule": "src/App.vue", "kind": "static", "external": false },
        { "importer": "src/main.ts", "specifier": "vue", "kind": "static", "external": true, "retained": true }
    ]
}
```

## Fields

| Field | Meaning |
| --- | --- |
| `format`, `schemaVersion` | Always `true-import-cost/build-snapshot` and `1`. See [Stability](#stability) for other versions |
| `id` | Identifies this build, such as `webview@1764150000000`, the target and the time it finished |
| `target` | Name of the build target |
| `createdAt` | When the build finished, in milliseconds since the epoch. Used to detect stale results |
| `bundler` | Name and version of the bundler (`esbuild`, `vite`, `webpack`, `rspack` or any other), and the engine underneath (Vite on Rollup or Rolldown) |
| `mode` | `production` or `development`, when known |
| `root` | Directory every module path is relative to, relative to the snapshot file's own folder. Paths use forward slashes |
| `modules[].id` | Unique id: the path, plus the query of a virtual sub-module (`App.vue?vue&type=style&index=0&lang.css`), or the bundler's id for a module without a file. When webpack builds two modules from one file and query, such as a stylesheet and the CSS a plugin extracts from it, the second id ends in its module type (`src/style.css\|css/mini-extract`) |
| `modules[].path` | The file the module comes from, without the query |
| `modules[].virtual` | The module has no file of its own, such as a bundler helper or webpack's runtime (`webpack/runtime/…`) |
| `modules[].entry` | The module is an entry point of the build |
| `modules[].package*` | Package name, version and install root, for modules under `node_modules`. Two install roots are two package instances |
| `modules[].sourceBytes` | Size of the module's source before the build, when known |
| `modules[].contributions` | Bytes the module contributes to each chunk or asset, with their precision. No contribution means the build retained nothing of it |
| `chunks[]` | JavaScript (`kind: "js"`) and CSS (`kind: "css"`) output files and their size in bytes |
| `chunks[].entry`, `.dynamicEntry` | The chunk is an entry point of the build, or loaded on demand by a dynamic `import()` |
| `chunks[].entryModule` | The module the chunk was built for: its entry point, or the module the `import()` loads |
| `chunks[].imports`, `.dynamicImports`, `.css`, `.assets` | The chunks it loads before it runs, the chunks it loads with `import()`, and the stylesheets and other files it loads. An entry chunk and what it imports, transitively, with their stylesheets, load initially |
| `assets` | Other output files: `image`, `font`, `wasm`, `html`, `sourcemap` or `other`. Source maps do not count toward the size of a build |
| `imports` | The module graph: `static`, `dynamic`, `require`, `css` or `reference` edges between modules, or to an external `specifier`; `retained: false` marks an external import the output no longer contains. A `reference`, such as `new URL()` or `url()` in CSS, does not count toward the cost of an import |

Output ids, of chunks and assets alike, are their paths relative to the output directory, and a chunk names other outputs by those ids.

## Precision values

`bundler-reported`, `sourcemap-estimate`, `rendered-length`, `proportional-estimate` — see [measurements.md](measurements.md#precision).

## Limits

A snapshot may hold at most 500,000 modules, 2,000,000 imports, 50,000 chunks and 200,000 assets; a module at most 10,000 contributions; and each list of a chunk at most 50,000 ids. No string is longer than 4,096 characters, and the target, the bundler's name, version and engine, and package names and versions are 1 to 256 characters long. Byte counts are whole numbers of zero or more.

## Consistency

The ids of modules are unique, and so are the ids of outputs, chunks and assets together. Every module that an import or a chunk names exists, every output that a contribution or a chunk names exists, and an import that is not external names the module it resolves to.

## JSON Schema

[`packages/snapshot/build-snapshot.schema.json`](../packages/snapshot/build-snapshot.schema.json) is a JSON Schema (draft 2020-12) of the format, for tools in any language. It is generated from the validation, so the two cannot differ. Its `$id` is `https://raw.githubusercontent.com/Der-Floh/True-Import-Cost/main/packages/snapshot/build-snapshot.schema.json`, and the npm package carries it as `@true-import-cost/snapshot/build-snapshot.schema.json`.

The schema checks the shape and the limits. The [consistency rules](#consistency) are beyond JSON Schema: `parseSnapshot` in `@true-import-cost/snapshot`, the check the extension and the CLI run on every file, also applies them, so a file the schema accepts can still be rejected.

## Stability

Schema version 1 is stable: from True Import Cost 1.0 on, every release that reads version 1 reads every snapshot this page describes.

**What is stable:** the format marker; every field on this page, its type, whether it is required, and its meaning; the values of `precision`, `mode` and of the kinds of chunks, assets and imports; the limits; and the consistency rules.

**What may change within version 1:** additions that a reader of version 1 can ignore. A new field is optional and does not change what the existing fields mean. Readers drop fields they do not know: `parseSnapshot` returns the snapshot without them and the JSON Schema allows them, so an older reader reads a newer snapshot without the new information. A limit may be raised; a reader that knows only the old limit still rejects a snapshot beyond it. Writers should write only the fields this page lists: a field of their own is dropped by every reader and could clash with one that a later release adds.

**What bumps the version:** anything a reader of version 1 would reject or misread: a new required field, a field removed or renamed, a changed type, unit or meaning, a new value of `precision`, `mode` or a kind, a lower limit, or a new consistency rule. Until then, a writer uses the nearest existing value, such as the asset kind `other`, or a less precise precision.

**A newer version:** a reader rejects a snapshot of a schema version it does not read. When the version is higher than its own, the message says that the snapshot was written by a newer True Import Cost and that the extension or the CLI needs an update. The extension keeps using the last snapshot of that file it could read. When a version 2 comes, the extension and the CLI will read version 1 alongside it, and the plugins and `@true-import-cost/snapshot` will write it from a new major version of their own.

The measurement request and report that a plugin exchanges with the extension ([writing-a-plugin.md](writing-a-plugin.md#measurement-mode)) have a version of their own, also 1, under the same rules.
