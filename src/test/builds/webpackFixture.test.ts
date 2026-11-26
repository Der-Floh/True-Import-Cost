import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attributeFile, graphOf, only, readSnapshot } from './support';
import { BUNDLERS, buildFixture, bundlerVersion, WEBPACK_FIXTURE } from './webpackSupport';
import { duplicatePackages } from '../../core/graph/duplicates';
import { explainInclusion } from '../../core/graph/whyIncluded';
import { TrueImportCostPlugin } from '../../plugins/webpack';

import type { AttributedImport } from './support';
import type { Bundler, FixtureBuild } from './webpackSupport';
import type { BuildGraph } from '../../core/graph/buildGraph';
import type { BuildSnapshot } from '../../core/schema/snapshot';

const directories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-webpack-'));
    directories.push(directory);
    return directory;
}

async function buildSnapshot(bundler: Bundler, build: Partial<FixtureBuild> = {}, target = 'extension-host'): Promise<{ snapshot: BuildSnapshot; outputPath: string; outDir: string }> {
    const outDir = temporaryDirectory();
    const outputPath = path.join(temporaryDirectory(), 'dist');
    await buildFixture(bundler, { outputPath, plugins: [new TrueImportCostPlugin({ target, outDir })], ...build });
    return { snapshot: readSnapshot(path.join(outDir, `${target}.json`)), outputPath, outDir };
}

function precisionsOf(snapshot: BuildSnapshot): string[] {
    return [...new Set(snapshot.modules.flatMap(module => module.contributions.map(contribution => contribution.precision)))].sort();
}

afterAll(() => {
    for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe.each(BUNDLERS)('a real %s production build of the webpack-app fixture, through the plugin', (bundler) => {
    let snapshot: BuildSnapshot;
    let outputPath: string;
    let outDir: string;
    let graph: BuildGraph;
    let extension: Map<string, AttributedImport[]>;

    beforeAll(async () => {
        ({ snapshot, outputPath, outDir } = await buildSnapshot(bundler));
        graph = graphOf(snapshot);
        extension = attributeFile(graph, WEBPACK_FIXTURE, 'src/extension.js');
    });

    it('writes a valid snapshot with the bundler, the mode and the root', () => {
        expect(snapshot.target).toBe('extension-host');
        expect(snapshot.bundler).toEqual({ name: bundler, version: bundlerVersion(bundler) });
        expect(snapshot.mode).toBe('production');
        expect(path.resolve(outDir, snapshot.root)).toBe(WEBPACK_FIXTURE);
    });

    it('finds the entry point and records every emitted file at its minified size', () => {
        expect(graph.entries).toEqual(['src/extension.js']);
        for (const chunk of snapshot.chunks) {
            expect(chunk.bytes, chunk.id).toBe(statSync(path.join(outputPath, chunk.id)).size);
        }
    });

    it('names the modules inside concatenated modules by their path, and estimates them from the minified chunk', () => {
        const parse = snapshot.modules.find(module => module.id === 'node_modules/big-library/lib/parse.js');

        expect(parse?.contributions).toEqual([expect.objectContaining({ chunkId: 'extension.js', precision: 'proportional-estimate' })]);
        expect(precisionsOf(snapshot)).toEqual(['proportional-estimate']);
    });

    it('never attributes more bytes to a chunk than the chunk has', () => {
        for (const chunk of snapshot.chunks) {
            const attributed = snapshot.modules
                .flatMap(module => module.contributions)
                .filter(contribution => contribution.chunkId === chunk.id)
                .reduce((sum, contribution) => sum + contribution.bytes, 0);
            expect(attributed, chunk.id).toBeLessThanOrEqual(chunk.bytes + snapshot.modules.length);
        }
    });

    it('fills in package versions', () => {
        expect(graph.packageOf('node_modules/big-library/lib/parse.js')?.version).toBe('3.2.0');
    });

    it('shows vscode as external', () => {
        expect(only(extension, 'vscode')).toMatchObject({ status: 'external' });
    });

    it('measures a package used through named imports, which commands.js imports too, as entirely shared', () => {
        const cost = only(extension, 'big-library');
        const used = ['lib/parse.js', 'lib/validate.js', 'lib/shared.js'].reduce((sum, file) => sum + graph.bytesOf(`node_modules/big-library/${file}`), 0);

        expect(cost.status).toBe('bundled');
        if (cost.status === 'bundled') {
            expect(cost.match).toMatchObject({ confidence: 'exact', edge: { resolvedModule: 'node_modules/big-library/index.js' } });
            expect(cost.impact.bundledBytes).toBeGreaterThanOrEqual(used);
            expect(cost.impact.bundledBytes).toBeLessThanOrEqual(cost.package?.bytes ?? 0);
            expect(cost.impact.exclusiveBytes).toBe(0);
        }
    });

    it('counts only the export of a tree-shakable package that is used', () => {
        const cost = only(extension, 'tree-lib');

        expect(cost.status === 'bundled' ? cost.impact.bundledBytes : -1).toBe(graph.bytesOf('node_modules/tree-lib/used.js'));
        expect(graph.bytesOf('node_modules/tree-lib/unused.js')).toBe(0);
    });

    it('flags a package bundled in two versions, as two instances', () => {
        const cost = only(extension, 'dup-lib');
        const duplicate = duplicatePackages(graph).find(candidate => candidate.name === 'dup-lib');

        expect(duplicate?.instances.map(instance => instance.version).sort()).toEqual(['1.0.0', '2.0.0']);
        expect(cost.status === 'bundled' ? cost.duplicate?.name : undefined).toBe('dup-lib');
    });

    it('puts the dynamic import in a lazily loaded chunk with the package only it uses', () => {
        const cost = only(extension, './lazy.js');
        const chunk = snapshot.chunks.find(candidate => candidate.entryModule === 'src/lazy.js');

        expect(cost).toMatchObject({ status: 'bundled', lazy: true });
        expect(chunk).toMatchObject({ entry: false, dynamicEntry: true });
        expect(snapshot.chunks.find(candidate => candidate.entry)?.dynamicImports).toEqual([chunk?.id]);
        expect(graph.module('node_modules/lazy-lib/index.js')?.contributions.map(contribution => contribution.chunkId)).toEqual([chunk?.id]);
    });

    it('measures a module only this file imports as entirely exclusive, and one commands.js imports too as shared', () => {
        const helper = only(extension, './helper.js');
        const shared = only(extension, './shared.js');

        expect(helper.status === 'bundled' ? helper.impact.exclusiveBytes : -1).toBe(graph.bytesOf('src/helper.js'));
        expect(shared.status === 'bundled' ? shared.impact.exclusiveBytes : -1).toBe(0);
    });

    it('matches a require call to its CommonJS module', () => {
        const cost = only(attributeFile(graph, WEBPACK_FIXTURE, 'src/legacy.js'), 'cjs-lib');

        expect(cost.status === 'bundled' ? cost.match.edge.kind : undefined).toBe('require');
    });

    it('lists the import chains that reach a module of a concatenated package', () => {
        const report = explainInclusion(graph, ['node_modules/big-library/lib/shared.js']);
        const importers = report.chains.map(chain => chain.steps[chain.steps.length - 2]?.moduleId);

        expect(report.reachable).toBe(true);
        expect(importers).toEqual(expect.arrayContaining(['node_modules/big-library/lib/parse.js', 'node_modules/big-library/lib/validate.js']));
    });
});

describe.each(BUNDLERS)('the %s plugin in other configurations', (bundler) => {
    it('estimates module sizes from the source maps when the build writes them', async () => {
        const { snapshot } = await buildSnapshot(bundler, { devtool: 'hidden-source-map' });
        const extension = snapshot.modules.find(module => module.id === 'src/extension.js');

        expect(precisionsOf(snapshot)).toContain('sourcemap-estimate');
        expect(extension?.contributions[0]?.precision).toBe('sourcemap-estimate');
    });

    it('calls a development build a development build', async () => {
        const { snapshot } = await buildSnapshot(bundler, { mode: 'development' });

        expect(snapshot.mode).toBe('development');
    });

    it('names the target after the output file, then after webpack\'s name', async () => {
        const outDir = temporaryDirectory();
        const outputPath = path.join(temporaryDirectory(), 'dist');
        await buildFixture(bundler, { outputPath, filename: 'extension-host.js', plugins: [new TrueImportCostPlugin({ outDir })] });
        await buildFixture(bundler, { outputPath, name: 'host', plugins: [new TrueImportCostPlugin({ outDir })] });

        expect(readSnapshot(path.join(outDir, 'extension-host.json')).target).toBe('extension-host');
        expect(readSnapshot(path.join(outDir, 'host.json')).target).toBe('host');
    });

    it('leaves the last snapshot alone when a build fails', async () => {
        const { outDir } = await buildSnapshot(bundler);
        const file = path.join(outDir, 'extension-host.json');
        const before = readFileSync(file, 'utf8');

        await expect(buildFixture(bundler, {
            outputPath: path.join(temporaryDirectory(), 'dist'),
            entry: 'data:text/javascript,export const broken = ;',
            plugins: [new TrueImportCostPlugin({ target: 'extension-host', outDir })],
        })).rejects.toThrow();

        expect(readFileSync(file, 'utf8')).toBe(before);
    });
});
