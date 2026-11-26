# Changelog

All notable changes to True Import Cost are documented here. The extension, the bundler plugins and the CLI share this file; package entries name their package.

## 1.0.0

The first release. It covers the whole [roadmap](docs/roadmap.md), v0.1 to v1.0: the core extension, Vite and Vue support, the dependency graph, the dashboard with build comparisons, advanced cost analysis, and a stable snapshot format that plugins for any bundler can write.

### Extension

- webpack 5 and Rspack stats JSON (`stats.toJson()`, `webpack --json`) are read like esbuild metafiles: modules by path, including those inside concatenated modules, chunks and assets, imports from each module's reasons, externals and package versions. Module sizes are scaled to the minified files. Stats without modules, chunks, assets or reasons are rejected with a message that says how to write them
- Named and default imports of a barrel module are charged with the modules that define the names they use, instead of everything the barrel re-exports: `import { debounce } from 'lodash-es'` costs `debounce.js` and what it imports. The trace follows `export … from`, `export * as`, `export *` and imports that are only exported again, through nested barrels, resolves each re-export through the build's own module graph, and uses the names the import uses as values. What a barrel imports for itself, such as a stylesheet, still counts; CommonJS barrels keep their module-level cost
- The hover says when an import was traced through a barrel and names the defining modules; exclusive bytes of a traced import are a lower bound while other files import the same barrel
- Inline import costs read from build metadata: raw esbuild metafiles and True Import Cost snapshots, found in any `.true-import-cost` folder or listed in `trueImportCost.targets`
- Bundled, exclusive, shared and lazy bytes per import, from the build's module graph; the whole package's size in the hover
- External, tree-shaken, removed (unused), type-only and unrecorded imports each get their own label
- Estimates are marked with `~`, and the hover names the precision of every size and how the import was matched to the build
- Import analysis with the TypeScript compiler API: every static, dynamic, `require`, `import =` and re-export form; usage by symbol, so shadowed names never count
- Vue single-file components: `<script>` and `<script setup>` in place, and template-only use of components and directives
- Build targets: one per metadata file, a target picker, per-target costs in the hover
- Explain Why Included: import chains from the entry points to a module or package, in the Why Included view
- Duplicate-package diagnostics with a quick fix that explains each copy
- Bundle Contents view and a status bar item for the active target
- Stale detection: hints say `source changed` once a file is newer than its build
- Watching: metadata files are re-read when the build writes them, and the last good snapshot stays when a file cannot be read
- Restricted Mode support; no network access, no telemetry, nothing executed
- Bundle dashboard: treemap, initial and lazily loaded chunks, CSS and assets by kind, packages with versions and lazy part, duplicates, size history and a comparison across build targets
- Compare Builds: pin a baseline or compare with any metafile or snapshot; every package, chunk and module shows its change, and so does the status bar
- Size budgets per target for the total, the initial load, JavaScript, CSS, single imports and named packages, with warnings on the imports concerned
- Show Importers: from a package or module to the lines that import it
- Baselines and size history live in VS Code's storage for the workspace, never in the workspace
- Measure Import by Building Without It: builds the target once as is and once without the import, through the plugin's measurement mode, and the hover shows how much smaller the build is. It runs only when you ask, in a trusted workspace, after you allow the command, and never writes the build output
- Measured costs from two builds of your own: when the build after the pinned baseline differs from it by exactly one import, the hover shows the difference
- Measure Standalone Size of the Imported Package: the imported names and their package bundled by themselves with the project's esbuild or Rolldown, minified and gzipped
- Large builds: metadata files of 512 kB or more are read, validated and indexed in a worker thread, so the extension host stays responsive, and exclusive bytes come from a dominator tree built once per build instead of a walk of the whole build per import. For a synthetic build of 60,000 modules, the imports of the first document cost under a second
- Each GitHub release carries `SHA256SUMS` for its VSIX next to the build provenance attestation; [SECURITY.md](SECURITY.md#verifying-a-release) shows how to check both
- The snapshot format is stable within schema version 1 ([Stability](docs/snapshot-schema.md#stability)). A snapshot of a newer version is rejected with a message to update the extension or the CLI, and a file of another format says it is not a True Import Cost build snapshot. A snapshot whose chunks name an output it does not list is rejected

### `@true-import-cost/snapshot` 1.0.0

- New package for writing a True Import Cost plugin for any other bundler: the format's types and constants, `SnapshotBuilder`, `parseSnapshot`, `withPackageVersions`, `writeSnapshot`, the target and root helpers, and the measurement protocol. No dependencies; Node.js 18 and later
- `build-snapshot.schema.json`: the format as a JSON Schema (draft 2020-12), generated from the validation
- [Writing a plugin for another bundler](docs/writing-a-plugin.md), with a complete example

### `@true-import-cost/esbuild` 1.0.0

- Turns on the metafile and writes a normalised snapshot with the esbuild version, the build mode and package versions after every successful build
- Measurement mode for True Import Cost's measured costs: with `TRUE_IMPORT_COST_MEASURE` set, takes one import out of a file in memory, writes no output, and puts its snapshot in a temporary folder

### `@true-import-cost/vite` 1.0.0

- Writes a snapshot after every production build, for Rollup-based Vite and Rolldown-based Vite 8
- Per-module sizes from rendered lengths scaled to the minified chunk, or from the source maps when the build writes them
- CSS split across the stylesheets and Vue style blocks that produced it; emitted assets attributed to the modules they came from
- Measurement mode for True Import Cost's measured costs: with `TRUE_IMPORT_COST_MEASURE` set, takes one import out of a file in memory, writes no output, and puts its snapshot in a temporary folder

### `@true-import-cost/webpack` 1.0.0

- New plugin for webpack 5 and Rspack 1 and 2: writes a True Import Cost snapshot after every successful build, with per-module sizes from the source maps when the build writes them
- Measurement mode for True Import Cost's measured costs: with `TRUE_IMPORT_COST_MEASURE` set, a loader takes one import out of a file in memory, and nothing is emitted or cleaned

### `@true-import-cost/cli` 1.0.0

- `true-import-cost summary`, `compare` and `check` for CI pipelines, reading the same metadata as the extension: True Import Cost snapshots, esbuild metafiles and any other supported build metadata
- `summary`: total, JavaScript, CSS, other assets, initial and lazily loaded sizes, the largest packages with their versions, and duplicate packages
- `compare`: the change in every size, the packages added, removed or changed in size or version, the chunks, and the modules that changed most; the markdown format is made for pull request comments
- `check`: evaluates the target's `trueImportCost.budgets`, read from a JSON file or straight from `.vscode/settings.json`, and exits with 1 when a budget is exceeded
- Text, markdown and documented JSON output, deterministic and ASCII; text from the metadata is escaped so it cannot forge lines in a CI log
- Exit code 2 with a one-line message for usage errors and unreadable files; metadata larger than `--max-size` (64 MB) is rejected unread
