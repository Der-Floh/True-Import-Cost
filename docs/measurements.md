# Measurements

Every number True Import Cost shows is one of the measurements below, and the hover says which, how precise it is, and which build it comes from.

## Definitions

Take an import edge from document **D** to module **M** in a build with entry points **E**.

| Measurement | Definition |
| --- | --- |
| Bundled | Sum of retained bytes of every module reachable from M through static imports, `require` calls and CSS imports |
| Lazy | Retained bytes reachable from M only through at least one dynamic `import()` |
| Exclusive | Bundled bytes of the modules that are no longer reachable from E once the edges from D to M are removed |
| Shared | Bundled − exclusive |
| Whole package | Retained bytes of every module of M's package instance (one install location of one version) |
| External | The build left the import external; it costs nothing in the bundle and is loaded at runtime |
| Tree-shaken | The build resolved M but retained no byte of what it reaches |
| Removed | The build has no trace of the import because nothing uses it as a value (TypeScript drops such imports), or recorded it as an external import that is gone from the output |
| Type-only | `import type`, or every binding marked `type`: erased during compilation |

For a dynamic `import()` the edge itself is lazy, so its bundled bytes are what loads on demand.

## Precision

| Precision | Where it comes from | Marked |
| --- | --- | --- |
| Reported by the bundler | esbuild's `bytesInOutput` for each input of each output | no |
| Source-map estimate | Bytes of the minified chunk that its source map attributes to each source | `~` |
| Rendered length | Rollup/Rolldown's `renderedLength` when the chunk is not minified | `~` |
| Proportional estimate | Rendered lengths scaled down so they add up to the minified chunk; CSS files split in proportion to the source of their stylesheets | `~` |

A sum of modules is as precise as its least precise module.

## Limits of module-level attribution

Bundlers report bytes per module, not per import statement or per function. Consequences:

- A barrel module (`index.js` re-exporting everything) reaches every module of the package that the build kept, so two imports of different exports from the same barrel both count the package's retained modules. The exclusive and shared numbers stay correct for the module graph, and the hover's usage section shows what each import actually uses.
- Exclusive bytes assume everything else stays as it is. Removing an import can change minification, constant folding, tree shaking and chunk boundaries, so the real difference of two builds can differ. Measuring that difference is the *marginal cost* on the [roadmap](roadmap.md).
- Runtime helpers, module wrappers and chunk glue belong to no module; they count toward the totals in the status bar, not toward any import.

## Staleness

A snapshot describes one build. When a document is dirty, or saved after the build ran, its hints say `source changed`, and an import without a record says `not in last build` instead of `no build record`. A metadata file that cannot be read keeps the last good snapshot in use, with a warning in the status bar.
