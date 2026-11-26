# Architecture

True Import Cost never builds your project. It reads the metadata your own build already writes, normalises it into one format, builds a module graph from it, and connects the imports of the open document to that graph.

```text
esbuild build ──► metafile ─────────────┐
esbuild build ──► @true-import-cost/esbuild ──► snapshot ─┤
Vite build ─────► @true-import-cost/vite ─────► snapshot ─┤
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
| Core | `src/core` | nothing above it; no `vscode`, no Node built-ins | the extension host, both bundler plugins, the CLI |
| Parser | `src/parser` | core | the extension host, loaded lazily from `out/parser.js` |
| Extension | `src/extension` | core; the parser's types, and its code only through `services/parserHost.ts` | the extension host |
| Bundler plugins | `src/plugins` | core and Node built-ins | the user's build |
| CLI | `src/cli` | core and Node built-ins | CI pipelines, as `@true-import-cost/cli` |
| Shared contract | `src/shared` | core types only | the extension host and the dashboard |
| Dashboard | `src/webview` | `src/shared` and pure core modules | the dashboard webview |

ESLint enforces the boundaries (`eslint.config.mjs`), and the `core` Vitest project has no `vscode` alias, so a core module that imports it fails to resolve.

## Core

- **Schema** (`schema/snapshot.ts`, `schema/validate.ts`) — the `BuildSnapshot` format described in [snapshot-schema.md](snapshot-schema.md), validated with `zod/mini` plus consistency checks between modules, imports and outputs.
- **Adapters** (`adapters/`) — the `BundlerAdapter` interface (`supports`, `normalize`), the esbuild metafile adapter, the Rollup/Rolldown adapter the Vite plugin uses, and a pass-through for snapshots. `normalizeMetadata` picks the adapter that recognises the input and validates whatever it produces. A new bundler is a new adapter; nothing else changes.
- **Graph** (`graph/`) — `BuildGraph` indexes modules by id and by path, imports in both directions, package instances by install root (two installed versions are two instances), retained bytes and the precision of each module. On top of it: reachability, the impact of one import edge (bundled, lazy, exclusive and shared bytes), why-included chains and duplicate packages. Every traversal keeps a visited set, so cycles terminate.
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

## CLI

`src/cli` is the `true-import-cost` command, published as `@true-import-cost/cli`: one CommonJS file without dependencies, built by `scripts/buildPackages.mjs`. `metadata.ts` loads a file as `metadataLoader.ts` does, with Node's `fs` in place of `vscode.workspace.fs`; `reports/` turns one or two build graphs into plain JSON reports with `sizeTotals`, `compareBuilds`, `duplicatePackages` and `evaluateBudgets`; `output/` writes a report as text or markdown, or the report itself as JSON. Files are read only through `CliEnvironment`, so the tests run whole commands in memory.

## Performance

| Operation | Approach |
| --- | --- |
| Activation | Registers providers and starts finding metadata; `out/extension.js` is about 115 kB minified, and a test keeps the parser out of it |
| First analysis | Loads `out/parser.js` once |
| Analysis | One parse per document version, after the document has been unchanged for `analysis.debounceMs` |
| Costs | Graph traversals cached per graph and import edge |
| Barrels | Only for named imports of modules whose imports branch; each file on the way parsed once until the metadata reloads |
| Builds | None. The extension only reads what your build writes |
