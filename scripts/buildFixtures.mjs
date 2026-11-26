import path from 'node:path';
import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import * as esbuild from 'esbuild';
import { build } from 'vite';
import webpack from 'webpack';

import { trueImportCost } from '../packages/vite/dist/index.mjs';
import { TrueImportCostPlugin } from '../packages/webpack/dist/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'src', 'test', 'fixtures', 'projects');

await esbuild.build({
    absWorkingDir: path.join(FIXTURES, 'esbuild-node'),
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    minify: true,
    external: ['vscode'],
    outfile: 'dist/extension.js',
    metafile: true,
    logLevel: 'warning',
}).then(async (result) => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const directory = path.join(FIXTURES, 'esbuild-node', '.true-import-cost');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'extension-host.json'), JSON.stringify(result.metafile));
});

await build({
    root: path.join(FIXTURES, 'vite-vue'),
    configFile: false,
    logLevel: 'warn',
    plugins: [vue(), trueImportCost({ target: 'webview' })],
    build: { sourcemap: 'hidden' },
});

await new Promise((resolve, reject) => {
    const compiler = webpack({
        context: path.join(FIXTURES, 'webpack-app'),
        mode: 'production',
        target: 'node',
        entry: { extension: './src/extension.js' },
        output: { path: path.join(FIXTURES, 'webpack-app', 'dist'), filename: '[name].js', library: { type: 'commonjs2' } },
        externals: { vscode: 'commonjs vscode' },
        devtool: 'hidden-source-map',
        plugins: [new TrueImportCostPlugin({ target: 'extension-host' })],
    });
    compiler.run((error, stats) => {
        const failure = error ?? (stats?.hasErrors() ? new Error(stats.toString('errors-only')) : undefined);
        compiler.close(() => (failure ? reject(failure) : resolve()));
    });
});

console.log('Built the fixtures; their metadata is in their .true-import-cost folders.');
