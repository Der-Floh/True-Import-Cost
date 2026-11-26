import path from 'node:path';
import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import * as esbuild from 'esbuild';
import { build } from 'vite';

import { trueImportCost } from '../packages/vite/dist/index.mjs';

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

console.log('Built both fixtures; their metadata is in their .true-import-cost folders.');
