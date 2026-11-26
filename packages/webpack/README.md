# @true-import-cost/webpack

A webpack and Rspack plugin that records what your production build contains, for the [True Import Cost](https://github.com/Der-Floh/True-Import-Cost) VS Code extension.

True Import Cost shows the cost of every import inline in the editor, measured from your real build output. It can read webpack's stats JSON itself; this plugin writes a much smaller snapshot instead, where the extension finds it, with the size of every module estimated from the minified files (from their source maps when the build writes them), the version of every bundled package and the build mode.

## Install

```bash
npm install --save-dev @true-import-cost/webpack
```

## Use with webpack

```js
// webpack.config.js
const { TrueImportCostPlugin } = require('@true-import-cost/webpack');

module.exports = {
    mode: 'production',
    target: 'node',
    entry: './src/extension.ts',
    output: { filename: 'extension.js', library: { type: 'commonjs2' } },
    externals: { vscode: 'commonjs vscode' },
    plugins: [new TrueImportCostPlugin({ target: 'extension-host' })],
};
```

## Use with Rspack

Rspack runs webpack plugins, so the same plugin works there:

```js
// rspack.config.mjs
import { TrueImportCostPlugin } from '@true-import-cost/webpack';

export default {
    mode: 'production',
    entry: './src/main.ts',
    plugins: [new TrueImportCostPlugin({ target: 'webview' })],
};
```

After every successful build the plugin writes `.true-import-cost/<target>.json` in webpack's context directory (the `context` option, which defaults to the directory the build runs in). A failed build leaves the last snapshot in place, and watch mode rewrites it after every rebuild. webpack 5 and Rspack 1 and 2 are supported. `trueImportCost(options)` is the same as `new TrueImportCostPlugin(options)`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `target` | webpack's `name`, then the output file's name when it has no placeholders, then the name of the context directory | Name of the build target, such as `extension-host`. The extension keeps targets apart |
| `outDir` | `.true-import-cost` | Directory the snapshot is written to, relative to webpack's context |
| `fileName` | `<target>.json` | File name of the snapshot |

The build mode is webpack's `mode`; with `mode: 'none'`, a minimized build counts as a production build. When one configuration file exports several configurations, give each a `name` or a `target` of its own, so their snapshots do not overwrite each other.

The folder gets a `.gitignore` the first time it is created, since a snapshot describes one machine's build. Delete it to commit snapshots.

## Measuring an import

When you ask True Import Cost to measure an import, it runs your build twice with the environment variable `TRUE_IMPORT_COST_MEASURE` set, once as is and once with the import taken out. While that variable is set, the plugin:

- takes the import out of that one file in memory, through a loader that sees the file before any other loader; the file on disk stays unchanged
- writes no build output and cleans nothing; if another plugin turns emitting back on, the build stops instead of writing
- writes its snapshot to a temporary folder instead of `outDir`

The loader runs in the build process, so a file that a worker loader such as `thread-loader` processes cannot be edited: that measurement stops with an error. Builds without the variable are not affected.

## How sizes are measured

webpack and Rspack report how big each module is before minification. The plugin therefore:

- reads per-module sizes from the source maps when the build writes them — set `devtool` to `'hidden-source-map'` or `'source-map'` for the most accurate numbers (the `eval` variants write no source map files);
- otherwise scales the module sizes so they add up to each minified file;
- counts the modules webpack concatenated into one (scope hoisting) one by one;
- splits each CSS file across the modules that produced it, in proportion to their size;
- attributes an emitted asset, such as an image, to the module it was imported as;
- keeps webpack's runtime as modules of its own (`webpack/runtime/…`), which count toward the totals but toward no import.

The extension marks every estimate with `~` and says in the hover how it was made.

## Without the plugin

The extension also reads stats JSON directly, as long as it lists the modules with their reasons, the chunks and the assets. `webpack --json=.true-import-cost/web.json` writes such stats; Rspack's default stats leave the modules out, so write `stats.toJson({ all: true })` there. Stats give scaled estimates only, never source map estimates, and are much larger than a snapshot: the extension reads files up to `trueImportCost.maxMetadataSizeMB`.

## License

MIT
