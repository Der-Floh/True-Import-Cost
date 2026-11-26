# @true-import-cost/esbuild

An esbuild plugin that records what your production build contains, for the [True Import Cost](https://github.com/Der-Floh/True-Import-Cost) VS Code extension.

True Import Cost shows the cost of every import inline in the editor, measured from your real build output. It already reads a plain esbuild metafile; this plugin adds the esbuild version, the build mode and the version of every bundled package, and writes the result where the extension finds it.

## Install

```bash
npm install --save-dev @true-import-cost/esbuild
```

## Use

```ts
import * as esbuild from 'esbuild';
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

After every successful build the plugin writes `.true-import-cost/extension-host.json` next to esbuild's working directory. It turns on `metafile` itself. A failed build leaves the last snapshot in place, and watch mode rewrites it after every rebuild.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `target` | the output file's name | Name of the build target, such as `extension-host`. The extension keeps targets apart |
| `outDir` | `.true-import-cost` | Directory the snapshot is written to, relative to esbuild's working directory |
| `fileName` | `<target>.json` | File name of the snapshot |
| `mode` | `production` when `minify` is on | Whether the build is a production or a development build |

The folder gets a `.gitignore` the first time it is created, since a snapshot describes one machine's build. Delete it to commit snapshots.

## Without the plugin

A plain metafile works as well:

```bash
esbuild src/extension.ts --bundle --minify --platform=node --metafile=.true-import-cost/extension-host.json --outfile=dist/extension.js
```

## License

MIT
