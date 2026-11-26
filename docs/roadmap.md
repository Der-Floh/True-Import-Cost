# Roadmap

Each release produces something useful on its own. Version 0.1.0 covers the first three milestones.

## v0.1 — Core MVP ✅

- [x] Initialize the TypeScript project (one npm package; the bundler plugins publish from `packages/`)
- [x] Implement the shared metadata schema
- [x] Implement the esbuild metafile adapter
- [x] Resolve TypeScript import declarations
- [x] Register VS Code inlay hints
- [x] Watch metadata files
- [x] Handle external and type-only imports
- [x] Add initial fixture tests

## v0.2 — Vite and Vue support ✅

- [x] Vite plugin for Rollup-based Vite and Rolldown-based Vite 8
- [x] Rollup/Rolldown adapter with rendered-length, proportional and source-map estimates
- [x] Vue single-file component script blocks at their original offsets
- [x] Template-only use of components and directives
- [x] CSS and asset contributions
- [x] Multiple build targets and a target picker

## v0.3 — Dependency graph ✅

- [x] Module graph with forward and reverse traversal and cycle safety
- [x] Exclusive and shared bytes per import
- [x] Explain why included
- [x] Package instances by install root, and duplicate-package diagnostics
- [x] Bundle Contents view
- [x] Stale-result detection and last-good snapshots

## v0.4 — Dashboard and comparisons

- [ ] Vue webview dashboard with a treemap of the active target
- [ ] Initial versus lazily loaded chunks, CSS, fonts, images and WebAssembly
- [ ] Compare two builds of a target, and build size history
- [ ] Compare build targets
- [ ] Configurable size budgets
- [ ] Navigate from a dependency to the imports that pull it in

## v0.5 — Advanced cost analysis

- [ ] Usage-aware attribution through barrel modules (named import → the module that defines it)
- [ ] Optional standalone size of a package
- [ ] Compare two user-generated builds as a measured marginal cost
- [ ] Automated counterfactual builds for safely identifiable cases, behind Workspace Trust and explicit consent
- [ ] Webpack and Rspack adapters
- [ ] A CLI for CI pipelines

## v1.0 — Stable release

- [ ] Stable snapshot schema and adapter API for third-party bundler adapters
- [ ] Performance budgets for large graphs, with the graph built in a background worker
- [ ] Published VSIX checksums alongside the release attestations
