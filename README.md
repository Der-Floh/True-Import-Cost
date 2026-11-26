# <img src="./assets/icon-x512.png" alt="" height="48px"> True Import Cost

See what each import really costs **in your production build** — read from the metadata your own bundler writes, not estimated by bundling every import on its own. Every number says what it measures: what an import pulls into the bundle, how much of that is exclusive to it, how much it shares with other imports, and what the build removed again.

> **Measured, not guessed.** Classic import-cost extensions bundle each import in isolation, so they cannot know what your tree shaking keeps, which modules two imports share, or that an import is external. True Import Cost reads your real build output and tells you which of its numbers are reported by the bundler and which are estimates.

---

## ✨ Features

- **Production-aware sizes** — module sizes come from your bundler: esbuild's `bytesInOutput`, what Vite, Rollup or Rolldown rendered into each chunk, or webpack's and Rspack's module sizes scaled to the minified files. Hints and hovers are read from your build's metadata, never from a bundler run of their own
- **Bundled, exclusive and shared, kept apart** — `12.4 kB bundled · 3.1 kB exclusive` says what an import pulls in and how much of it no other import reaches; `· shared` says the build keeps all of it for other imports anyway
- **Honest about precision** — a `~` marks an estimate. The hover says whether sizes are reported by the bundler, estimated from source maps, rendered lengths, or rendered lengths scaled to the minified chunk
- **Real shared-module analysis** — sharing comes from the module graph of the build, not from package names, so two imports of different exports from the same package are measured by the modules they actually reach
- **Through barrel files** — `import { debounce } from 'lodash-es'` costs `debounce` and what it imports, not everything `lodash-es` re-exports: named imports are traced through `export … from` and `export *`, nested barrels included, to the modules that define the names you use, and the hover names them
- **Separate build targets** — an extension host and a webview are separate builds, and a dependency in both is two costs, never one. Pick the target the hints measure against, or let each file use the target that contains it
- **Usage-aware** — the hover lists what an import is used for: the members called or read, uses in a Vue template, and values that escape so the bundler may have to keep everything
- **Removed and erased imports** — type-only imports, imports TypeScript drops because nothing uses them as values, tree-shaken modules and external modules each get their own label instead of a misleading size
- **Vue single-file components** — `<script>` and `<script setup>` blocks are analysed in place, and a component or directive used only in the template counts as used. VS Code knows `.vue` files once a Vue extension such as *Vue (Official)* is installed
- **Explain why included** — the shortest import chains from each entry point to a module or package, in the *Why Included* view. Click an inline hint to ask
- **Duplicate packages** — a package bundled in two versions, or from two install locations, gets an information diagnostic with the size of each copy
- **Stale-result detection** — a file changed since the last build says `source changed` instead of passing old numbers off as current
- **Bundle Contents view** — the packages, project sources and bundler-generated code of the active target, largest first
- **Bundle dashboard** — a treemap of the build, initial versus lazily loaded chunks, CSS, images, fonts and WebAssembly, the largest packages, duplicates, budgets and a size history, all a click away from the code
- **Compare builds** — pin a build as the baseline, or pick any metafile or snapshot, and every package, chunk and module shows what changed since
- **Size budgets** — limits per target for the total, the initial load, JavaScript, CSS, any single import and named packages. An import or package over budget gets a warning where it is imported
- **Show importers** — from a package or module to every line in your code that imports it
- **Measured marginal cost** — build the target once with and once without an import, or compare two builds of your own, and the hover shows exactly what the build saves without it
- **Standalone size** — the imported names and the whole package bundled by themselves with your project's bundler, minified and gzipped
- **CLI for CI** — [`@true-import-cost/cli`](packages/cli/README.md) prints a build's sizes and its largest and duplicate packages, compares two builds as a pull request comment, and fails the pipeline when a size budget is exceeded
- **Local, and runs nothing unless you ask** — no network access, no telemetry. Hints, hovers and the dashboard only read build metadata and source files, which are validated and size-limited, and nothing is written to the workspace. Measuring an import runs your build only when you ask, in a trusted workspace, after you allow the command

---

## 🧰 Usage

True Import Cost needs your build to write its metadata once; after that, every build refreshes the hints on its own.

### 1. Let your build write its metadata

Anything in a `.true-import-cost` folder of your workspace is picked up automatically.

**esbuild, with no extra dependency** — write the metafile there:

```bash
esbuild src/extension.ts --bundle --platform=node --minify --external:vscode --metafile=.true-import-cost/extension-host.json --outfile=dist/extension.js
```

**esbuild, with the plugin** — [`@true-import-cost/esbuild`](packages/esbuild/README.md) also records the esbuild version, the build mode and the package versions:

```ts
import { trueImportCost } from '@true-import-cost/esbuild';

await esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    minify: true,
    platform: 'node',
    external: ['vscode'],
    outfile: 'dist/extension.js',
    plugins: [trueImportCost({ target: 'extension-host' })],
});
```

**Vite** — Vite and Rollup have no metafile, so add [`@true-import-cost/vite`](packages/vite/README.md). It works with Rollup-based Vite and with Rolldown-based Vite 8:

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { trueImportCost } from '@true-import-cost/vite';

export default defineConfig({
    plugins: [vue(), trueImportCost({ target: 'webview' })],
});
```

**webpack and Rspack** — add [`@true-import-cost/webpack`](packages/webpack/README.md). It writes a snapshot after every build, with module sizes estimated from the minified files (from their source maps when `devtool` writes them), the bundler version, the build mode and the package versions. Rspack runs it unchanged:

```js
// webpack.config.js or rspack.config.js
const { TrueImportCostPlugin } = require('@true-import-cost/webpack');

module.exports = {
    // …
    plugins: [new TrueImportCostPlugin({ target: 'extension-host' })],
};
```

Raw stats work too: `webpack --json=.true-import-cost/extension-host.json`, or `stats.toJson({ all: true })` written to that folder for Rspack.

A metafile or stats file that already lives somewhere else can be added with **Import Build Metadata**, or listed in `trueImportCost.targets`.

### 2. Open a source file

```text
import * as vscode from 'vscode';                  external
import { debounce } from 'lodash-es';              2.1 kB bundled · shared
import library from 'big-library';                 48.2 kB bundled · 12.4 kB exclusive
import type { User } from './types';               (hidden: type-only)
import { unused } from 'unused-lib';               0 B · unused, removed by the build
const chart = await import('./chart');             ~18 kB lazy
```

Hover an import for the full picture: the table below, the packages it pulls in, how its bindings are used, the build it was measured against and when that build ran. Click a hint to see why it is included.

### Reading the hints

| Hint | Meaning |
| --- | --- |
| `12.4 kB bundled` | What the build kept of the imported module and everything it imports eagerly; for a named import of a barrel, of the modules that define the names it uses |
| `· 3.1 kB exclusive` | The part of that no other import reaches. It would leave the build if this import did, as far as the module graph can tell |
| `· shared` | Everything this import pulls in is also reached through other imports |
| `~18 kB lazy` | A dynamic `import()`: the code loads on demand, in its own chunk where the bundler splits code |
| `+2 kB lazy` | What the imported module loads on demand through its own dynamic imports |
| `~` | An estimate rather than a size the bundler reported. Rollup-family bundlers report module sizes before minification, so True Import Cost scales them, or reads the source maps when the build writes them |
| `external` | Left external by the build and loaded at runtime, such as `vscode` in an extension host |
| `0 B · tree-shaken` | Resolved by the build, but none of its code survived |
| `0 B · unused, removed by the build` | The import never reached the bundle, because nothing uses it as a value |
| `0 B · used as a type only` / `0 B · type-only` | Erased by TypeScript. Hidden unless `trueImportCost.display.typeOnly` is on |
| `no build record` | The build's metadata has no record of this import |
| `not in last build` / `· source changed` | The file changed after the build ran, so the numbers may be out of date |

### What is measured

| Measurement | What it is | Source |
| --- | --- | --- |
| Bundled | Retained bytes of the imported module and its eager imports; for a named import of a barrel, of the modules that define what it uses | Build metadata and its module graph, and the barrel's source |
| Exclusive | Bundled bytes no other path from an entry point reaches; a lower bound for a barrel other files import too | Module graph with this import removed |
| Shared | Bundled bytes other imports reach as well | Module graph |
| Lazy | Bytes behind dynamic imports | Module graph |
| Whole package | Retained bytes of every module of the package instance | Build metadata |
| External, tree-shaken, removed, type-only | No bytes in the bundle, and why | Build metadata and source analysis |
| Measured | How much smaller the build is without the import | Two builds: with and without it |
| Standalone | The imported names, and the whole package, bundled by themselves | Your project's esbuild or Rolldown |

Named and default imports of a barrel are traced through its re-exports to the modules that define what they use; their exclusive bytes count other imports of the same barrel as using all of it. Attribution is per module: bundlers report what each **module** contributes, not what each import statement or function does, so a module that several imports reach counts toward each of them. Exclusive bytes assume the rest of the build stays as it is; removing an import can also change minification and chunking, which only a second build shows: see [Measuring an import](#measuring-an-import). [docs/measurements.md](docs/measurements.md) has the details.

### Measuring an import

Every number above comes from one build. **Measure Import by Building Without It** — from the hover, or with the cursor on an import — builds the target twice, once as your code is and once with the import taken out, and from then on the hover shows the difference:

```text
Measured · Built without this import, the build is 70 kB smaller, all of it in the initial load · 2 minutes ago
```

- **It needs the plugin in the build.** The True Import Cost plugin (`@true-import-cost/esbuild`, `/vite` or `/webpack`) takes the import out of that one file while bundling — your files are never changed — keeps the build from writing its output, and writes its reports to a temporary folder in VS Code's storage.
- **The command** is `trueImportCost.measure.command` for the target or `*`; without one, `npx --no vite build` for a Vite target, or `npm run build` when `package.json` has a `build` script. It runs in the folder of the nearest `package.json`.
- **It runs only when you ask**, only in a trusted workspace, and only after you allow the command, once or for the workspace. Your build configuration and its plugins run as they do when you build yourself, and anything else the command does still happens: if your build script also deploys or uploads, set `trueImportCost.measure.command` to the bare bundler command.
- **Without letting the extension run anything:** pin the current build (**Compare Builds**), take the import out and build yourself. When the new build differs from the baseline by exactly that import, the hover shows the difference as measured between the two builds.

**Measure Standalone Size of the Imported Package** bundles the names you import, and the whole package, by themselves with the esbuild or Rolldown installed in the project, for the platform of the target, and shows both sizes minified and gzipped. It does not use your build configuration and writes nothing to your project. **Forget Measured Import Costs** clears every measurement and every command you allowed.

### Bundle dashboard

**Show Bundle Dashboard** — or the graph icon on the *Bundle Contents* view — opens the whole build of a target at a glance:

- **Sizes** — total, JavaScript, CSS, other assets, the initial load (entry chunks, what they import statically and their CSS) and what loads lazily, each with its change since the baseline
- **Treemap** — project sources by folder, each package instance, the modules the bundler generates, and the output no module accounts for (runtime helpers and module wrappers), sized by what the build kept. Click a tile to look inside it, or to open the module; lazily loaded code is marked
- **Packages** — every bundled package with its versions, its lazily loaded part, its change and its budget, sortable and searchable, with *Explain why included* and *Show importers* on each
- **Chunks and assets**, **duplicates**, **budgets**, the **modules that changed most** since the baseline, the **size history** of the target and, with several targets, a **comparison** of each package across them

**Compare Builds** pins the current build as the baseline, or compares with any metafile or snapshot you pick; the status bar then shows the change as well. Baselines and the size history are kept in VS Code's storage for this workspace, never in the workspace itself.

### Size budgets

```json
{
    "trueImportCost.budgets": {
        "webview": { "initial": "600 kB", "css": "80 kB", "packages": { "moment": 0, "lodash*": "30 kB" } },
        "*": { "import": "100 kB" }
    }
}
```

Budgets are keyed by build target, or `*` for every target; a target's own budget wins field by field. Sizes are bytes or text such as `30 kB`, `1.5 MB` or `500 KiB`. An import whose bundled size is over `import`, or a package over its limit in `packages`, gets a warning on the import; `total`, `initial`, `javascript` and `css` are checked in the status bar and the dashboard.

### In CI

[`@true-import-cost/cli`](packages/cli/README.md) reads the same metadata outside VS Code: `true-import-cost check .true-import-cost/webview.json --budgets .vscode/settings.json` checks the budgets above and exits with 1 when one is exceeded, and `true-import-cost compare` writes the change since another build as markdown for a pull request comment.

### Build targets

Every metadata file is one build target, named after its `target` (snapshots), its `id` in `trueImportCost.targets`, or its file name. A file that several targets contain — shared code in an extension host and a webview — is measured against one of them at a time: **Select Build Target** picks it, or *Automatic* uses the first target that contains the file. The hover lists the cost in every other target.

### Commands

| Command | What it does |
| --- | --- |
| **True Import Cost: Select Build Target** | Choose the build target the hints, views and status bar measure against |
| **True Import Cost: Import Build Metadata** | Pick an esbuild metafile, webpack or Rspack stats, or a snapshot anywhere, check it, and add it to `trueImportCost.targets` |
| **True Import Cost: Refresh Analysis** | Look for metadata again and read every file anew |
| **True Import Cost: Explain Why Included** | Show the import chains that pull a module or package into the build — for the import under the cursor, or one you pick |
| **True Import Cost: Toggle Inline Hints** | Turn the inline hints on or off (`trueImportCost.inlayHints.enabled`) |
| **True Import Cost: Clear Cache** | Forget every analysis and snapshot, and read everything again |
| **True Import Cost: Show Bundle Dashboard** | Open the dashboard of the active target |
| **True Import Cost: Compare Builds** | Pin the current build as the baseline, compare with a metafile or snapshot, or clear the baseline |
| **True Import Cost: Show Importers** | List every line that imports a package or module — the one under the cursor, or one picked in a view — and go to it |
| **True Import Cost: Clear Build History** | Forget the recorded size history of every target in this workspace |
| **True Import Cost: Measure Import by Building Without It** | Build the target with and without the import under the cursor, and show the difference in the hover |
| **True Import Cost: Measure Standalone Size of the Imported Package** | Bundle the imported names and their package by themselves, and show their size in the hover |
| **True Import Cost: Forget Measured Import Costs** | Forget every measured cost and standalone size, and every command you allowed to run, in this workspace |
| **True Import Cost: Show Log** | Open the log, which says which metadata was read and why a file was rejected |

The **True Import Cost** activity bar view has **Bundle Contents** (packages and modules of the active target, largest first) and **Why Included**. The status bar shows the active target and its total size; click it to switch targets.

---

## ⚙️ Settings

| Setting | Type | Default | Effect |
| --- | --- | --- | --- |
| `trueImportCost.enabled` | `boolean` | `true` | Show import costs at all. When off, nothing is read |
| `trueImportCost.inlayHints.enabled` | `boolean` | `true` | Show the inline hints. Hovers, diagnostics and views stay available |
| `trueImportCost.targets` | `array` | `[]` | Metadata files to read besides the ones found automatically: `{ "id", "metadata", "root" }`, paths relative to the workspace folder |
| `trueImportCost.autoDiscover` | `boolean` | `true` | Read every `*.json` in a `.true-import-cost` folder of the workspace |
| `trueImportCost.display.exclusive` | `boolean` | `true` | Add the exclusive part, or `shared`, to a hint |
| `trueImportCost.display.external` | `boolean` | `true` | Show `external` on imports the build leaves external |
| `trueImportCost.display.typeOnly` | `boolean` | `false` | Show hints on type-only imports |
| `trueImportCost.display.unresolved` | `boolean` | `true` | Show a hint on imports the build has no record of |
| `trueImportCost.analysis.usageAnalysis` | `boolean` | `true` | Work out how each imported binding is used, for the hover |
| `trueImportCost.analysis.debounceMs` | `number` | `300` | How long a document has to stay unchanged before it is analysed again |
| `trueImportCost.diagnostics.duplicatePackages` | `boolean` | `true` | Flag imports of a package that is bundled more than once |
| `trueImportCost.maxMetadataSizeMB` | `number` | `64` | Largest metadata file that is read; larger ones are rejected unread |
| `trueImportCost.budgets` | `object` | `{}` | Size budgets per build target; see [Size budgets](#size-budgets) |
| `trueImportCost.history.enabled` | `boolean` | `true` | Record the size of each new build for the dashboard's history chart |
| `trueImportCost.measure.command` | `object` | `{}` | The command that builds a target when you measure an import, by target id or `*`; see [Measuring an import](#measuring-an-import) |
| `trueImportCost.measure.timeoutSeconds` | `number` | `300` | How long one build may take when you measure an import before it is stopped |

An entry of `trueImportCost.targets`:

```json
{
    "trueImportCost.targets": [
        { "id": "extension-host", "metadata": "dist/meta.json" },
        { "id": "webview", "metadata": "webview/.true-import-cost/webview.json" }
    ]
}
```

`root` is only needed for a raw esbuild metafile or raw webpack stats whose paths are relative to a directory True Import Cost cannot work out: by default it tries the metafile's folder and each folder above it, up to the workspace folder, until the paths in the metafile exist.

In Restricted Mode the workspace's own `trueImportCost.targets`, `trueImportCost.maxMetadataSizeMB` and `trueImportCost.measure.command` are ignored, and measuring imports, which runs the workspace's build or bundler, is not available; metadata in `.true-import-cost` folders is still read.

---

## 🔒 Security and privacy

True Import Cost makes no network requests and collects no telemetry. Hints, hovers, diagnostics and the dashboard read JSON files and the source of your files, and never run your build, your scripts or your configuration. Measuring an import is the one exception: it runs the build command you allowed, when you ask, in a trusted workspace. Metadata is size-limited, parsed as data, validated against a strict schema and checked for consistency before it is used; text from it is escaped before it appears in a hover. See [SECURITY.md](SECURITY.md) for the full list and for reporting a vulnerability.

---

## 📦 Installing

Install **True Import Cost** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Florian-Noever.true-import-cost) or from [Open VSX](https://open-vsx.org/extension/Florian-Noever/true-import-cost), or from the command line:

```bash
code --install-extension Florian-Noever.true-import-cost
```

Every [GitHub release](https://github.com/Der-Floh/True-Import-Cost/releases) also carries its VSIX, for *Extensions → … → Install from VSIX…*, with its SHA-256 checksum and a build provenance attestation: [SECURITY.md](SECURITY.md#verifying-a-release) shows how to check both. `npm run package` builds one from source.

The bundler plugins are separate npm packages:

```bash
npm install --save-dev @true-import-cost/vite
```

```bash
npm install --save-dev @true-import-cost/esbuild
```

```bash
npm install --save-dev @true-import-cost/webpack
```

So is the CLI for CI pipelines:

```bash
npm install --save-dev @true-import-cost/cli
```

---

## 🧩 Repository

GitHub: [Der-Floh/True-Import-Cost](https://github.com/Der-Floh/True-Import-Cost)

Bug reports and feature requests are welcome via [Issues](https://github.com/Der-Floh/True-Import-Cost/issues).

---

## 🛠️ Developer Notes

### Architecture

| Layer | Where | Purpose |
| --- | --- | --- |
| Core | `src/core` | The snapshot schema and its validation, the esbuild and Rollup/Rolldown adapters, the module graph (reachability, exclusive and shared bytes, why-included chains, duplicates) and import attribution. No `vscode`, no Node built-ins: the bundler plugins and the CLI reuse it |
| Parser | `src/parser` | Import extraction and symbol-based usage analysis with the TypeScript compiler API, and Vue single-file components through `@vue/compiler-dom`. Bundled separately and loaded on first use, so activation does not pay for TypeScript |
| Extension | `src/extension` | Finding, reading and watching metadata, build targets, inlay hints, hovers, diagnostics, views, commands, baselines and history |
| Dashboard | `src/webview`, `src/shared` | Vue 3 webview built with Vite into one script, talking to the host only through the message contract in `src/shared` |
| Bundler plugins | `src/plugins`, published from `packages/` | `@true-import-cost/esbuild`, `@true-import-cost/vite` and `@true-import-cost/webpack`, built from the same core sources |
| CLI | `src/cli`, published from `packages/cli` | `true-import-cost summary`, `compare` and `check` for CI pipelines, on the same core |

[docs/architecture.md](docs/architecture.md) explains the data flow, [docs/snapshot-schema.md](docs/snapshot-schema.md) the metadata format and [docs/roadmap.md](docs/roadmap.md) what comes next.

### Build commands

npm, and nothing else — packaging needs it regardless, since `vsce` shells out to it.

```bash
npm ci                   # install exactly what package-lock.json pins
npm run compile          # check-types + lint + both host bundles + the dashboard + the plugin packages
npm run watch            # esbuild and tsc watchers, which is what F5 starts
npm test                 # build, then vitest: core, builds, host, webview, repo and cli
npm run test:integration # build, then the extension in a real VS Code through @vscode/test-electron
npm run fixtures         # build both fixture projects, so their launch configurations open with metadata
npm run package          # vsce package
```

`out/extension.js` is the extension host; `out/parser.js` holds TypeScript and the Vue compiler and is required the first time a document is analysed. `npm run bundle:packages` builds `packages/*/dist`: CommonJS, ES module and declaration files for the plugins, and the CLI's single `dist/cli.cjs`.

### Tests

Six Vitest projects: `core` (pure engine and parser, deliberately *without* a `vscode` alias), `builds` (real esbuild and Vite builds of the fixture projects in `src/test/fixtures/projects`, compared byte for byte with what the bundler reports, plus the plugins and measured builds), `host` (a hand-written `vscode` mock), `webview` (the dashboard in jsdom), `repo` (the manifest, the documentation, the dashboard's page template, the exact contents of the VSIX and of the npm packages) and `cli` (argument parsing and every output format with in-memory files, plus the built command run by Node against a real esbuild build). The fixture projects carry hand-written packages for shared internals, tree shaking, side effects, two versions of one package, cycles and CommonJS. The integration tests open a built fixture in VS Code and check hints, hovers, diagnostics and commands.

### CI & Releases

CI runs on every push and pull request through the shared workflows of [Florian-Noever/Florian-Noever](https://github.com/Florian-Noever/Florian-Noever/blob/main/.github/CI.md): one job runs `npm run ci:check`, one the integration tests, and one packs a preview VSIX.

To release the extension, bump the version with `npm version x.y.z --no-git-tag-version` and publish a GitHub release `vx.y.z` from a commit whose CI is green. The npm packages are released with the **Publish npm packages** workflow, which builds, tests and publishes a package with provenance through npm trusted publishing.

---

## 📜 License

Licensed under the [MIT](LICENSE) License.

<br>
<br>

[!["Buy me a coffee"](https://raw.githubusercontent.com/Florian-Noever/Florian-Noever/refs/heads/main/_meta/BuyMeACoffee/Buttons%20%26%20Icons/orange-button-x180.png)](https://www.buymeacoffee.com/florian_noever)
