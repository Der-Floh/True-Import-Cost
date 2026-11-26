# Snapshot format

A True Import Cost snapshot is one JSON file per build target, normally in a `.true-import-cost` folder. The bundler plugins write it; the extension also accepts a raw esbuild metafile and converts it to this format on read. The TypeScript definition is `src/core/schema/snapshot.ts`, the validation `src/core/schema/validate.ts`.

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
| `format`, `schemaVersion` | Always `true-import-cost/build-snapshot` and `1`. A reader rejects any other version |
| `target` | Name of the build target |
| `createdAt` | When the build finished, in milliseconds since the epoch. Used to detect stale results |
| `bundler` | Name and version of the bundler, and the engine underneath (Vite on Rollup or Rolldown) |
| `mode` | `production` or `development`, when known |
| `root` | Directory every module path is relative to, relative to the snapshot file's own folder |
| `modules[].id` | Unique id: the path, plus the query of a virtual sub-module (`App.vue?vue&type=style&index=0&lang.css`), or the bundler's id for a module without a file |
| `modules[].path` | The file the module comes from, without the query |
| `modules[].virtual` | The module has no file of its own, such as a bundler helper |
| `modules[].entry` | The module is an entry point of the build |
| `modules[].package*` | Package name, version and install root, for modules under `node_modules`. Two install roots are two package instances |
| `modules[].contributions` | Bytes the module contributes to each chunk or asset, with their precision. No contribution means the build retained nothing of it |
| `chunks` | JavaScript and CSS output files, their size, whether they are entry or lazily loaded chunks, and the chunks and assets they load |
| `assets` | Other output files: images, fonts, WebAssembly, HTML, source maps |
| `imports` | The module graph: `static`, `dynamic`, `require`, `css` or `reference` edges between modules, or to an external `specifier`; `retained: false` marks an external import the output no longer contains |

## Precision values

`bundler-reported`, `sourcemap-estimate`, `rendered-length`, `proportional-estimate` — see [measurements.md](measurements.md).

## Limits

A snapshot may hold at most 500,000 modules, 2,000,000 imports, 50,000 chunks and 200,000 assets, and no string longer than 4,096 characters. Every module an import or contribution names must exist, and ids must be unique.
