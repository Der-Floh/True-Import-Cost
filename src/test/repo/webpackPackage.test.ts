import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { buildFixture, WEBPACK_FIXTURE } from '../builds/webpackSupport';

import type { Bundler, FixturePlugin } from '../builds/webpackSupport';

interface PluginModule {
    readonly TrueImportCostPlugin: new (options: { readonly target: string }) => FixturePlugin;
}

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'packages/webpack/dist');
const MEASURE_ENV = 'TRUE_IMPORT_COST_MEASURE';
const require = createRequire(import.meta.url);
const directories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-webpack-package-'));
    directories.push(directory);
    return directory;
}

async function loadPlugin(entry: string): Promise<PluginModule> {
    return entry.endsWith('.cjs')
        ? require(path.join(DIST, entry)) as PluginModule
        : await import(pathToFileURL(path.join(DIST, entry)).href) as PluginModule;
}

afterEach(() => {
    delete process.env[MEASURE_ENV];
});

afterAll(() => {
    for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('the @true-import-cost/webpack package', () => {
    it('lets webpack and Rspack users each install it without the other bundler', () => {
        const manifest = JSON.parse(readFileSync(path.join(ROOT, 'packages/webpack/package.json'), 'utf8')) as { peerDependenciesMeta?: unknown };

        expect(manifest.peerDependenciesMeta).toEqual({ '@rspack/core': { optional: true }, webpack: { optional: true } });
    });

    it.each<[Bundler, string]>([['webpack', 'index.cjs'], ['rspack', 'index.mjs']])('takes an import out through the loader it ships, in %s from dist/%s', async (bundler, entry) => {
        const file = path.join(WEBPACK_FIXTURE, 'src', 'extension.js');
        const statement = "import { used } from 'tree-lib';";
        const start = readFileSync(file, 'utf8').indexOf(statement);
        const directory = temporaryDirectory();
        const outDir = path.join(directory, 'measure');
        writeFileSync(path.join(directory, 'request.json'), JSON.stringify({
            version: 1,
            outDir,
            edits: [{ file, start, end: start + statement.length, expected: statement, replacement: 'const used = void 0;' }],
        }));
        process.env[MEASURE_ENV] = path.join(directory, 'request.json');
        const { TrueImportCostPlugin } = await loadPlugin(entry);

        await buildFixture(bundler, { outputPath: path.join(directory, 'dist'), plugins: [new TrueImportCostPlugin({ target: 'extension-host' })] });

        expect(readdirSync(outDir).sort()).toEqual(['extension-host.edits.json', 'extension-host.json']);
        expect(JSON.parse(readFileSync(path.join(outDir, 'extension-host.edits.json'), 'utf8'))).toMatchObject({ applied: [file], missing: [] });
        expect(readFileSync(path.join(outDir, 'extension-host.json'), 'utf8')).not.toContain('node_modules/tree-lib/used.js');
    }, 60_000);
});
