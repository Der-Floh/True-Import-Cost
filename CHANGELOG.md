# Changelog

All notable changes to True Import Cost are documented here. The extension and the two bundler plugins share this file; plugin entries name their package.

## 0.1.0

The first release. It covers milestones v0.1 to v0.5 of the [roadmap](docs/roadmap.md): the core extension, Vite and Vue support, the dependency graph, the dashboard with build comparisons, and advanced cost analysis.

### Extension

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

### `@true-import-cost/esbuild` 0.1.0

- Turns on the metafile and writes a normalised snapshot with the esbuild version, the build mode and package versions after every successful build
- Measurement mode for True Import Cost's measured costs: with `TRUE_IMPORT_COST_MEASURE` set, takes one import out of a file in memory, writes no output, and puts its snapshot in a temporary folder

### `@true-import-cost/vite` 0.1.0

- Writes a snapshot after every production build, for Rollup-based Vite and Rolldown-based Vite 8
- Per-module sizes from rendered lengths scaled to the minified chunk, or from the source maps when the build writes them
- CSS split across the stylesheets and Vue style blocks that produced it; emitted assets attributed to the modules they came from
- Measurement mode for True Import Cost's measured costs: with `TRUE_IMPORT_COST_MEASURE` set, takes one import out of a file in memory, writes no output, and puts its snapshot in a temporary folder
