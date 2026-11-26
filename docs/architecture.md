# Architecture

True Import Cost never builds your project. It reads the metadata your own build already writes, normalises it into one format, builds a module graph from it, and connects the imports of the open document to that graph.

```text
esbuild build ──► metafile ─────────────┐
esbuild build ──► @true-import-cost/esbuild ──► snapshot ─┤
Vite build ─────► @true-import-cost/vite ─────► snapshot ─┤
webpack build ──► stats JSON ─────────────────────────────┤
webpack build ──► @true-import-cost/webpack ──► snapshot ─┤
Rspack build ───► @true-import-cost/webpack ──► snapshot ─┤
                                                           ▼
                               metadata store (find, validate, watch)
                                                           ▼
                                  BuildGraph per build target
                                                           ▼
     document ──► parser (imports, usage) ──► attribution ──► hints, hovers,
                                                                diagnostics, views
```

## Layers

| Layer | Path | May import | Runs in |
| --- | --- | --- | --- |
| Core | `src/core` | nothing above it; no `vscode`, no Node built-ins | the extension host, the bundler plugins, the CLI |
| Parser | `src/parser` | core | the extension host, loaded lazily from `out/parser.js` |
| Extension | `src/extension` | core; the parser's types, and its code only through `services/parserHost.ts` | the extension host |
| Bundler plugins | `src/plugins` | core and Node built-ins | the user's build |
| CLI | `src/cli` | core and Node built-ins | CI pipelines, as `@true-import-cost/cli` |
| Drivers | `src/driver` | core and Node built-ins | outside the extension host's thread: a Node process of its own, which the extension starts with VS Code's runtime to bundle a package by itself, and the worker thread that reads large build metadata |
| Shared contract | `src/shared` | core types only | the extension host and the dashboard |
| Dashboard | `src/webview` | `src/shared` and pure core modules | the dashboard webview |

ESLint enforces the boundaries (`eslint.config.mjs`), and the `core` Vitest project has no `vscode` alias, so a core module that imports it fails to resolve.

## Core

- **Schema** (`schema/snapshot.ts`, `schema/validate.ts`) — the `BuildSnapshot` format described in [snapshot-schema.md](snapshot-schema.md), validated with `zod/mini` plus consistency checks between modules, imports and outputs.
- **Adapters** (`adapters/`) — the `BundlerAdapter` interface (`supports`, `normalize`), the esbuild metafile adapter, the Rollup/Rolldown adapter the Vite plugin uses, the webpack and Rspack stats adapter, which the webpack plugin uses too, and a pass-through for snapshots. `normalizeMetadata` picks the adapter that recognises the input and validates whatever it produces. A new bundler is a new adapter; nothing else changes.
- **Graph** (`graph/`) — `BuildGraph` indexes modules by id and by path, imports in both directions, package instances by install root (two installed versions are two instances), retained bytes and the precision of each module. On top of it: reachability, the impact of one import edge (bundled, lazy, exclusive and shared bytes), why-included chains and duplicate packages. Every traversal keeps a visited set, so cycles terminate. Import costs walk a compact index of the graph (`graph/graphIndex.ts`), and exclusive bytes come from a dominator tree that is built once per build (`graph/exclusion.ts`): removing the imports of one document stops exactly the modules that every path from the entry points reaches through those imports.
- **Attribution** (`attribution/`) — matches an import of the document to an import edge of the build, traces a named import of a barrel to the modules that define what it uses (`barrels.ts`), and turns the result into an `ImportCost`.

## Matching an import to the build

The bundler resolved every import already, so True Import Cost uses its answer rather than resolving imports itself. In order:

1. **Exact** — the bundler recorded the specifier as written (esbuild's `original`, externals).
2. **Resolved** — for a relative import, the path with the extensions and index files bundlers try, including TypeScript's `.js` → `.ts`; for a package import, the edges from this file into that package, preferring the module that matches the subpath.
3. **Heuristic** — for an alias such as `@/components/Foo`, the one edge whose module path ends with the rest of the specifier. The hover says when this was used.

An import without an edge is type-only, removed by the build because nothing uses it as a value, or simply not in the build — the parser's usage analysis tells which.

## Tracing an import through a barrel

The module a named or default import resolves to may only pass on what other modules define. When it imports more than one module, `traceBarrel` (`core/attribution/barrels.ts`) looks up each name the import uses as a value in that module's exports: a name it defines ends the search, a named re-export or an import it only exports again leads to the module named in it, and `export *` to whichever of its modules exports the name. Each specifier is resolved with the matcher above, against the edges the bundler recorded for the module that contains it, so the trace follows the build's own resolution. Lookups keep the names already on their path and stop at a fixed depth, so cycles terminate. A module whose exports are unknown ends the trace as a defining module.

The trace names the defining modules, the barrels it passed through, and what those barrels import for their own code: every edge of theirs that no re-export explains, or that an import of their own code also needs. `scopedImpact` (`core/graph/impact.ts`) measures the barrels' own bytes and everything reachable from the rest, against the same rest of the build as `importImpact`, plus whatever the document's other imports of the barrel keep. When no trace is possible the cost is `importImpact`'s, unchanged. [measurements.md](measurements.md#imports-through-barrels) defines the numbers.

The exports come from `analyzeExports` in the parser. The extension reads them on demand: `ImportCostService` attributes the document's imports with the analyses it has, collects the modules the trace asked for and did not get, has `services/barrelExports.ts` read and parse those files through `vscode.workspace.fs`, and attributes again until nothing is missing. Files over 2 MB are not read, analyses are cached by file, and the cache is dropped whenever the build metadata reloads.

## Reading webpack and Rspack stats

`core/adapters/webpack.ts` reads the stats JSON of webpack 5 and Rspack, as `stats.toJson()` and `webpack --json` write it; `@true-import-cost/webpack` passes it the same JSON, asked for with the options it needs. Module names in stats are relative to webpack's `context` and may start with loaders (`./node_modules/css-loader/dist/cjs.js!./src/style.css`), so a module is named after the resource at the end of its name, query included; a module without a file, such as a `webpack/runtime/…` module or a context module, stays virtual under its name. A concatenated module (`./src/index.js + 4 modules`) gives way to the modules inside it, which take its chunks, and its own reasons, such as being the entry, go to its root module.

A module's `reasons` are the imports of it. Their type tells static, dynamic `import()`, `require`, CSS and reference imports apart, `userRequest` is the specifier as written, and the importer is the module inside a concatenated module whenever the stats name it. When the bundler skips a side-effect-free barrel, it points the reasons for the names an import uses at the modules that define them; those are kept only when the stats show no import of the barrel itself, so an import edge leads to the module its specifier resolves to. External modules become external imports, retained when a chunk or a concatenated module still contains them.

Every JavaScript and CSS file of a chunk is a chunk of the snapshot. Chunks of an entry point load initially and import the other chunks of their group; the chunks an `import()` loads are dynamic imports. Module sizes in stats are from before minification, so what a module contributes to a file is estimated, from the file's source map when the plugin has one and otherwise by scaling the JavaScript or CSS sizes of the file's modules to the file. Stats without modules, chunks, assets, reasons or the modules inside concatenated modules are rejected with an error that says how to write complete ones.

While True Import Cost measures, the plugin stops emitting through `shouldEmit`, tapped before any other plugin, turns `output.clean` off, and fails the build from `emit` should another plugin turn emitting back on. It applies the edits with `webpackLoader.cjs`, added as the last `enforce: 'pre'` rule so that it sees each file before any other loader. Rspack passes loader options on as JSON, so the loader finds the edits in the build process by a key in its options.

## Parser

`src/parser/script.ts` parses a document with the TypeScript compiler API and builds a one-file program with no libraries and no module resolution, which is fast and enough for the checker to resolve local symbols. Every identifier with the name of an imported binding is resolved to its symbol, so shadowed names never count. Each reference is classified as a type or a value use, and value uses further as calls, member accesses (`x.y`, `x['y']`, destructuring) or escapes (passed on, spread, exported, computed access).

`src/parser/vue.ts` parses a single-file component with `@vue/compiler-dom` in SFC mode, analyses each `<script>` block in place at its offset in the file, and collects the identifiers the template uses — component tags in both cases, custom directives, expressions — the way Vue's own compiler decides whether a `<script setup>` import is used.

`src/parser/exports.ts` reads what one module exports, for tracing through barrels: the names it defines, the names it re-exports and from which specifier (including an import it only exports again), its `export *` specifiers, and the imports its own code needs — side-effect imports, imports referenced outside export lists, dynamic imports and `require` calls. It works syntactically, on TypeScript and on plain JavaScript from `node_modules`. CommonJS (`module.exports`, `exports.x`, `export =`, `.cjs` and `.cts` files), Vue components, files without ES module syntax and files with syntax errors are reported as unknown.

TypeScript and the Vue compiler are several megabytes, so the parser is its own bundle, `out/parser.js`. The extension requires it the first time a document is analysed rather than on activation.

## Extension

- **Metadata** — `metadataLocator.ts` finds files (`trueImportCost.targets`, then `**/.true-import-cost/*.json`); `metadataLoader.ts` checks the size, parses, normalises, works out the directory the build's paths are relative to, and reads package versions; `snapshotStore.ts` keeps one target per file, watches the files and keeps the last good snapshot when an update cannot be read.
- **Documents** — `documentAnalyzer.ts` debounces and caches parser results per document version; `importCosts.ts` combines them with the active target into `DocumentCosts`; `staleness.ts` compares the file with the build's time.
- **Presentation** — `labels.ts` and `hoverContent.ts` turn costs into text; everything from metadata is escaped.
- **Providers and views** — inlay hints, hover, duplicate-package and budget diagnostics, the status bar, Bundle Contents and Why Included.
- **Dashboard** — `dashboard/dashboardModel.ts` turns a target, its baseline, its history and its budget into the plain JSON model of `src/shared/dashboard.ts`; `dashboard/dashboardPanel.ts` owns the webview panel, posts the model and acts on the messages of `src/shared/messages.ts` after checking them. The page is a Vue 3 app in `src/webview`, built by Vite into one script that `media/dashboard.html` loads under a nonce-based content security policy. It renders the model as text only: icons come from a fixed set of codicons, and a test makes sure no other HTML is ever inserted. The treemap is a squarified layout (`treemap/squarify.ts`) that shows one level at a time and folds tiles too small to see (`treemap/nodes.ts`); the history chart's scales are in `chart/scales.ts`.
- **Comparison and history** — `core/compare.ts` compares two builds by package, chunk and module. A chunk is matched by its entry module, or else by its file name without the content hash; chunks that share such a name, like esbuild's `chunk-<hash>.js`, are paired by the modules they hold. `core/chunks.ts` decides what loads initially; `core/budgets.ts` reads and checks budgets. Baselines and history entries are stored as JSON in the extension's storage by `services/baselineStore.ts` and `services/historyStore.ts`.
- **Measuring** — `measure/importMeasurer.ts` plans the edit that takes an import out of the saved file (`parser/removal.ts`), finds the build command (`measure/buildCommand.ts`), asks before it runs anything (`measure/consent.ts`), runs the build twice through `measure/buildRunner.ts`, the one module allowed a child process, and compares the two snapshots (`core/measurement.ts`). The request it hands the plugins, and the report they write back, are `core/measureProtocol.ts`. `measure/standaloneSizes.ts` runs `out/standalone.js` (`src/driver`) to bundle a package by itself, and both kinds of result are kept in VS Code's storage (`services/measurementStore.ts`).

## CLI

`src/cli` is the `true-import-cost` command, published as `@true-import-cost/cli`: one CommonJS file without dependencies, built by `scripts/buildPackages.mjs`. `metadata.ts` loads a file as `metadataLoader.ts` does, with Node's `fs` in place of `vscode.workspace.fs`; `reports/` turns one or two build graphs into plain JSON reports with `sizeTotals`, `compareBuilds`, `duplicatePackages` and `evaluateBudgets`; `output/` writes a report as text or markdown, or the report itself as JSON. Files are read only through `CliEnvironment`, so the tests run whole commands in memory.

## Performance

| Operation | Approach |
| --- | --- |
| Activation | Registers providers and starts finding metadata; `out/extension.js` is about 170 kB minified, and a test keeps the parser out of it |
| Reading metadata | A file of 512 kB or more is decoded, normalised and validated in a worker thread (`out/metadataWorker.js`), which also builds the graph's indexes and hands them over without copying; the extension host parses the finished snapshot and builds its `BuildGraph`. Smaller files are read on the host, and so is every file once the worker fails to start or stops unexpectedly |
| First analysis | Loads `out/parser.js` once |
| Analysis | One parse per document version, after the document has been unchanged for `analysis.debounceMs` |
| Costs | One walk of what an import reaches, cached per graph and import edge; exclusive bytes from the dominator tree, instead of a walk of the whole build per import |
| Barrels | Only for named imports of modules whose imports branch; each file on the way parsed once until the metadata reloads |
| Builds | None, unless you measure an import or a standalone size: then the build command, or the project's bundler, runs once or twice in a process of its own |

For a synthetic build of 60,000 modules and 240,000 imports, a 30 MB esbuild metafile, the worker takes about 3 seconds while the extension host stays free. The host then spends about half a second parsing the snapshot and building the graph. The 54 imports of the entry point cost about 0.7 seconds together, and each later document tens of milliseconds.

`src/test/core/performance.test.ts` holds a build of 30,000 modules to budgets that leave room for slow CI machines: reading the metadata, building the graph, costing the first and the next document, indexing the graph in the background, adopting those indexes, and comparing two builds. A change that brings back a walk of the whole build per import fails them.
