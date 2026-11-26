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
- Exclusive bytes assume everything else stays as it is. Removing an import can change minification, constant folding, tree shaking and chunk boundaries, so the real difference of two builds can differ. [Measured costs](#measured-costs) are that difference.
- Runtime helpers, module wrappers and chunk glue belong to no module; they count toward the totals in the status bar, not toward any import.

## Measured costs

Every number above is read from one build. A **measured** cost comes from two:

| Measurement | Definition |
| --- | --- |
| Built without | Total output of the build as it is, minus the total output of the same build with the import taken out. The hover also gives the part of the difference in the initial load |
| Between two builds | The same difference between a pinned baseline and a later build, when the two differ by exactly one first-party import, no package version changed, and the rest of the first-party code changed by at most 1% (256 bytes at least, which absorbs renamed minified identifiers) |
| Standalone | The imported names, and the whole package, bundled by themselves with the project's esbuild or Rolldown, minified, for the platform of the target: Node.js when the build leaves Node.js built-ins or `vscode` external, browsers otherwise. Gzipped sizes use level 9 |

A measured cost includes everything the build does differently without the import: minification, constant folding, tree shaking and chunk boundaries. It is the difference one build makes, not a property of the import: a second import that shares modules with the first saves less on its own than both do together.

To build without an import, True Import Cost plans an edit of the saved file: a named or default import becomes `const name = void 0`, a namespace import `const name = {}`, a side-effect import an empty statement, a dynamic `import()` `Promise.resolve({})`, a `require()` call `{}`, and a re-export the same names exported as `void 0`. `export * from` has no names to stand in for and cannot be measured. The bundler plugin applies the edit in memory while it loads the file, after checking that the file still contains the text the edit replaces, and reports which files it edited; a measurement whose edit was not applied is discarded.

## Staleness

A snapshot describes one build. When a document is dirty, or saved after the build ran, its hints say `source changed`, and an import without a record says `not in last build` instead of `no build record`. A metadata file that cannot be read keeps the last good snapshot in use, with a warning in the status bar.
