# @true-import-cost/vite

A Vite plugin that records what your production build contains, for the [True Import Cost](https://github.com/Der-Floh/True-Import-Cost) VS Code extension.

True Import Cost shows the cost of every import inline in the editor, measured from your real build output. Vite, Rollup and Rolldown have no metafile, so this plugin writes one: the chunks and assets of the build, what each module contributes to them, and the module graph.

## Install

```bash
npm install --save-dev @true-import-cost/vite
```

## Use

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { trueImportCost } from '@true-import-cost/vite';

export default defineConfig({
    plugins: [vue(), trueImportCost({ target: 'webview' })],
});
```

After every `vite build` the plugin writes `.true-import-cost/webview.json` in Vite's root. It runs for builds only and changes nothing about the build's output. Vite 5 to 7 (Rollup) and Vite 8 (Rolldown) are supported.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `target` | the name of Vite's root directory | Name of the build target, such as `webview`. The extension keeps targets apart |
| `outDir` | `.true-import-cost` | Directory the snapshot is written to, relative to Vite's root |
| `fileName` | `<target>.json` | File name of the snapshot. A build with several outputs, such as a library in `es` and `cjs`, writes `<target>.json` for the first format and `<target>.<format>.json` for the others |

The folder gets a `.gitignore` the first time it is created, since a snapshot describes one machine's build. Delete it to commit snapshots.

## How sizes are measured

Rollup and Rolldown report how long each module was when it was rendered into its chunk, which is before minification. The plugin therefore:

- reads per-module sizes from the source maps when the build writes them — set `build.sourcemap` to `true` or `'hidden'` for the most accurate numbers;
- otherwise scales the rendered lengths so they add up to the minified chunk;
- splits each CSS file across the stylesheets and Vue `<style>` blocks that produced it, in proportion to their source;
- attributes an emitted asset, such as an image, to the module it was imported as.

The extension marks every estimate with `~` and says in the hover how it was made.

## License

MIT
