import { existsSync } from 'node:fs';
import { listFiles, PackageManager } from '@vscode/vsce';
import { beforeAll, describe, expect, it } from 'vitest';

const SHIPS = [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'assets/activity-bar.svg',
    'assets/icon-x512.png',
    'media/dashboard.html',
    'out/extension.js',
    'out/metadataWorker.js',
    'out/parser.js',
    'out/standalone.js',
    'package.json',
    'public/dashboard.css',
    'public/dashboard.js',
];

const BUILT = ['out/extension.js', 'out/parser.js', 'out/standalone.js', 'out/metadataWorker.js', 'public/dashboard.js', 'public/dashboard.css'];

let files: readonly string[] = [];

beforeAll(async () => {
    const unbuilt = BUILT.filter(path => !existsSync(path));
    if (unbuilt.length > 0) {
        throw new Error(`Not built: ${unbuilt.join(', ')}. Run npm run bundle and npm run build:webview first, as npm test does.`);
    }
    const listed = await listFiles({ cwd: process.cwd(), packageManager: PackageManager.None });
    files = listed.map(file => file.split('\\').join('/')).sort();
}, 60_000);

describe('what the VSIX contains', () => {
    it('is exactly the files the extension needs, and nothing else', () => {
        expect([...files]).toEqual(SHIPS);
    });

    it('carries no source, no fixture, no source map and no bundler plugin', () => {
        expect(files.filter(file => file.startsWith('src/') || file.startsWith('packages/') || file.startsWith('docs/'))).toEqual([]);
        expect(files.filter(file => file.endsWith('.ts') || file.endsWith('.map'))).toEqual([]);
    });
});
