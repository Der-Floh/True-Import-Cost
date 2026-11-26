# <img src="./assets/icon-x512.png" alt="" height="48px"> True Import Cost

See what each import really costs **in your production build** — read from the metadata your own bundler writes, not estimated by bundling every import on its own. Every number says what it measures: what an import pulls into the bundle, how much of that is exclusive to it, how much it shares with other imports, and what the build removed again.

> **Measured, not guessed.** Classic import-cost extensions bundle each import in isolation, so they cannot know what your tree shaking keeps, which modules two imports share, or that an import is external. True Import Cost reads your real build output and tells you which of its numbers are reported by the bundler and which are estimates.

---

## ✨ Features

- **Production-aware sizes** — module sizes come from your bundler: esbuild's `bytesInOutput`, or what Vite, Rollup or Rolldown rendered into each chunk. The VS Code extension never runs a bundler itself
- **Bundled, exclusive and shared, kept apart** — `12.4 kB bundled · 3.1 kB exclusive` says what an import pulls in and how much of it no other import reaches; `· shared` says the build keeps all of it for other imports anyway
- **Honest about precision** — a `~` marks an estimate. The hover says whether sizes are reported by the bundler, estimated from source maps, rendered lengths, or rendered lengths scaled to the minified chunk
- **Real shared-module analysis** — sharing comes from the module graph of the build, not from package names, so two imports of different exports from the same package are measured by the modules they actually reach
- **Separate build targets** — an extension host and a webview are separate builds, and a dependency in both is two costs, never one. Pick the target the hints measure against, or let each file use the target that contains it
- **Usage-aware** — the hover lists what an import is used for: the members called or read, uses in a Vue template, and values that escape so the bundler may have to keep everything
- **Removed and erased imports** — type-only imports, imports TypeScript drops because nothing uses them as values, tree-shaken modules and external modules each get their own label instead of a misleading size
- **Vue single-file components** — `<script>` and `<script setup>` blocks are analysed in place, and a component or directive used only in the template counts as used. VS Code knows `.vue` files once a Vue extension such as *Vue (Official)* is installed
- **Explain why included** — the shortest import chains from each entry point to a module or package, in the *Why Included* view. Click an inline hint to ask
- **Duplicate packages** — a package bundled in two versions, or from two install locations, gets an information diagnostic with the size of each copy
- **Stale-result detection** — a file changed since the last build says `source changed` instead of passing old numbers off as current
- **Bundle Contents view** — the packages, project sources and bundler-generated code of the active target, largest first
- **Local and read-only** — no network access, no telemetry, never executes workspace code. Build metadata is validated and size-limited before it is read

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

A metafile that already lives somewhere else can be added with **Import Build Metadata**, or listed in `trueImportCost.targets`.

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
| `12.4 kB bundled` | What the build kept of the imported module and everything it imports eagerly |
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
| Bundled | Retained bytes of the imported module and its eager imports | Build metadata and its module graph |
| Exclusive | Bundled bytes no other path from an entry point reaches | Module graph with this import removed |
| Shared | Bundled bytes other imports reach as well | Module graph |
| Lazy | Bytes behind dynamic imports | Module graph |
| Whole package | Retained bytes of every module of the package instance | Build metadata |
| External, tree-shaken, removed, type-only | No bytes in the bundle, and why | Build metadata and source analysis |

Attribution is per module: bundlers report what each **module** contributes, not what each import statement or function does, so a module that several imports reach counts toward each of them. Exclusive bytes assume the rest of the build stays as it is; removing an import can also change minification and chunking. [docs/measurements.md](docs/measurements.md) has the details. A standalone size and a measured marginal cost from differential builds are on the [roadmap](docs/roadmap.md).

### Build targets

Every metadata file is one build target, named after its `target` (snapshots), its `id` in `trueImportCost.targets`, or its file name. A file that several targets contain — shared code in an extension host and a webview — is measured against one of them at a time: **Select Build Target** picks it, or *Automatic* uses the first target that contains the file. The hover lists the cost in every other target.

### Commands

| Command | What it does |
| --- | --- |
| **True Import Cost: Select Build Target** | Choose the build target the hints, views and status bar measure against |
| **True Import Cost: Import Build Metadata** | Pick an esbuild metafile or a snapshot anywhere, check it, and add it to `trueImportCost.targets` |
| **True Import Cost: Refresh Analysis** | Look for metadata again and read every file anew |
| **True Import Cost: Explain Why Included** | Show the import chains that pull a module or package into the build — for the import under the cursor, or one you pick |
| **True Import Cost: Toggle Inline Hints** | Turn the inline hints on or off (`trueImportCost.inlayHints.enabled`) |
| **True Import Cost: Clear Cache** | Forget every analysis and snapshot, and read everything again |
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

An entry of `trueImportCost.targets`:

```json
{
    "trueImportCost.targets": [
        { "id": "extension-host", "metadata": "dist/meta.json" },
        { "id": "webview", "metadata": "webview/.true-import-cost/webview.json" }
    ]
}
```

`root` is only needed for a raw esbuild metafile whose paths are relative to a directory True Import Cost cannot work out: by default it tries the metafile's folder and each folder above it, up to the workspace folder, until the paths in the metafile exist.

In Restricted Mode the workspace's own `trueImportCost.targets` and `trueImportCost.maxMetadataSizeMB` are ignored; metadata in `.true-import-cost` folders is still read, and nothing is ever executed.

---

## 🔒 Security and privacy

True Import Cost makes no network requests, collects no telemetry and never runs your build, your scripts or your configuration. It reads JSON files and the source of the documents you open. Metadata is size-limited, parsed as data, validated against a strict schema and checked for consistency before it is used; text from it is escaped before it appears in a hover. See [SECURITY.md](SECURITY.md) for the full list and for reporting a vulnerability.

---

## 📦 Installing

Install **True Import Cost** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Florian-Noever.true-import-cost) or from [Open VSX](https://open-vsx.org/extension/Florian-Noever/true-import-cost), or from the command line:

```bash
code --install-extension Florian-Noever.true-import-cost
```

Every [GitHub release](https://github.com/Der-Floh/True-Import-Cost/releases) also carries its VSIX, for *Extensions → … → Install from VSIX…*. `npm run package` builds one from source.

The bundler plugins are separate npm packages:

```bash
npm install --save-dev @true-import-cost/vite
```

```bash
npm install --save-dev @true-import-cost/esbuild
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
| Core | `src/core` | The snapshot schema and its validation, the esbuild and Rollup/Rolldown adapters, the module graph (reachability, exclusive and shared bytes, why-included chains, duplicates) and import attribution. No `vscode`, no Node built-ins: the bundler plugins and a future CLI reuse it |
| Parser | `src/parser` | Import extraction and symbol-based usage analysis with the TypeScript compiler API, and Vue single-file components through `@vue/compiler-dom`. Bundled separately and loaded on first use, so activation does not pay for TypeScript |
| Extension | `src/extension` | Finding, reading and watching metadata, build targets, inlay hints, hovers, diagnostics, views and commands |
| Bundler plugins | `src/plugins`, published from `packages/` | `@true-import-cost/esbuild` and `@true-import-cost/vite`, built from the same core sources |

[docs/architecture.md](docs/architecture.md) explains the data flow, [docs/snapshot-schema.md](docs/snapshot-schema.md) the metadata format and [docs/roadmap.md](docs/roadmap.md) what comes next.

### Build commands

npm, and nothing else — packaging needs it regardless, since `vsce` shells out to it.

```bash
npm ci                   # install exactly what package-lock.json pins
npm run compile          # check-types + lint + both host bundles + the plugin packages
npm run watch            # esbuild and tsc watchers, which is what F5 starts
npm test                 # build, then vitest: core, builds, host and repo
npm run test:integration # build, then the extension in a real VS Code through @vscode/test-electron
npm run fixtures         # build both fixture projects, so their launch configurations open with metadata
npm run package          # vsce package
```

`out/extension.js` is the extension host; `out/parser.js` holds TypeScript and the Vue compiler and is required the first time a document is analysed. `npm run bundle:packages` builds `packages/*/dist` with CommonJS, ES module and declaration files.

### Tests

Four Vitest projects: `core` (pure engine and parser, deliberately *without* a `vscode` alias), `builds` (real esbuild and Vite builds of the fixture projects in `src/test/fixtures/projects`, compared byte for byte with what the bundler reports, plus both plugins), `host` (a hand-written `vscode` mock) and `repo` (the manifest, the documentation, the exact contents of the VSIX and of both npm packages). The fixture projects carry hand-written packages for shared internals, tree shaking, side effects, two versions of one package, cycles and CommonJS. The integration tests open a built fixture in VS Code and check hints, hovers, diagnostics and commands.

### CI & Releases

CI runs on every push and pull request through the shared workflows of [Florian-Noever/Florian-Noever](https://github.com/Florian-Noever/Florian-Noever/blob/main/.github/CI.md): one job runs `npm run ci:check`, one the integration tests, and one packs a preview VSIX.

To release the extension, bump the version with `npm version x.y.z --no-git-tag-version` and publish a GitHub release `vx.y.z` from a commit whose CI is green. The plugin packages are released with the **Publish npm packages** workflow, which builds, tests and publishes a package with provenance through npm trusted publishing.

---

## 📜 License

Licensed under the [MIT](LICENSE) License.

<br>
<br>

[!["Buy me a coffee"](https://raw.githubusercontent.com/Florian-Noever/Florian-Noever/refs/heads/main/_meta/BuyMeACoffee/Buttons%20%26%20Icons/orange-button-x180.png)](https://www.buymeacoffee.com/florian_noever)
