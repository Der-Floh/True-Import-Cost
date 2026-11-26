import { beforeAll, describe, expect, it } from 'vitest';

import { attributeFile, buildEsbuildFixture, ESBUILD_FIXTURE, graphOf, only, withFixtureVersions } from './support';
import { normalizeEsbuildMetafile } from '../../core/adapters/esbuild';
import { sizeTotals } from '../../core/chunks';
import { duplicatePackages } from '../../core/graph/duplicates';
import { explainInclusion } from '../../core/graph/whyIncluded';
import { parseSnapshot } from '../../core/schema/validate';

import type { AttributedImport } from './support';
import type { BuildGraph } from '../../core/graph/buildGraph';
import type { BuildSnapshot } from '../../core/schema/snapshot';
import type { Metafile } from 'esbuild';

let metafile: Metafile;
let snapshot: BuildSnapshot;
let graph: BuildGraph;
let extension: Map<string, AttributedImport[]>;

function bytesInOutput(inputPath: string): number {
    return Object.values(metafile.outputs).reduce((sum, output) => sum + (output.inputs[inputPath]?.bytesInOutput ?? 0), 0);
}

beforeAll(async () => {
    metafile = (await buildEsbuildFixture()).metafile;
    snapshot = await withFixtureVersions(normalizeEsbuildMetafile(metafile, { target: 'extension-host', createdAt: 1 }), ESBUILD_FIXTURE);
    graph = graphOf(snapshot);
    extension = attributeFile(graph, ESBUILD_FIXTURE, 'src/extension.ts');
});

describe('a real esbuild production build, normalised', () => {
    it('validates against the snapshot schema', () => {
        expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot))).ok).toBe(true);
    });

    it('reports exactly the bytes esbuild reports for every module', () => {
        for (const module of snapshot.modules) {
            const reported = module.contributions.reduce((sum, contribution) => sum + contribution.bytes, 0);
            expect(reported, module.id).toBe(bytesInOutput(module.id));
        }
    });

    it('marks every contribution as reported by the bundler', () => {
        const precisions = new Set(snapshot.modules.flatMap(module => module.contributions.map(contribution => contribution.precision)));
        expect([...precisions]).toEqual(['bundler-reported']);
    });

    it('sums a package from the modules the build kept of it', () => {
        const instance = [...graph.packages().values()].find(candidate => candidate.name === 'big-library');
        const expected = ['index.js', 'lib/parse.js', 'lib/validate.js', 'lib/format.js', 'lib/shared.js']
            .reduce((sum, file) => sum + bytesInOutput(`node_modules/big-library/${file}`), 0);

        expect(instance?.bytes).toBe(expected);
        expect(instance?.bytes).toBeGreaterThan(0);
    });

    it('finds the entry point and the output size', () => {
        expect(graph.entries).toEqual(['src/extension.ts']);
        expect(sizeTotals(graph.snapshot).javascript).toBe(Object.values(metafile.outputs).reduce((sum, output) => sum + output.bytes, 0));
    });
});

describe('the imports of src/extension.ts against that build', () => {
    it('shows vscode as external', () => {
        expect(only(extension, 'vscode')).toMatchObject({ status: 'external' });
    });

    it('charges the exports extension.ts uses from a package barrel commands.ts imports too, all of them shared', () => {
        const cost = only(extension, 'big-library');
        const used = ['index.js', 'lib/parse.js', 'lib/validate.js', 'lib/shared.js'].reduce((sum, file) => sum + bytesInOutput(`node_modules/big-library/${file}`), 0);

        expect(cost.status).toBe('bundled');
        if (cost.status === 'bundled') {
            expect(cost.match.confidence).toBe('exact');
            expect(cost.barrel?.definers).toEqual(['node_modules/big-library/lib/parse.js', 'node_modules/big-library/lib/validate.js']);
            expect(cost.impact.bundledBytes).toBe(used);
            expect(cost.package?.bytes).toBe(used + bytesInOutput('node_modules/big-library/lib/format.js'));
            expect(cost.impact.exclusiveBytes).toBe(0);
            expect(cost.impact.sharedBytes).toBe(cost.impact.bundledBytes);
        }
    });

    it('erases the type-only import and keeps the value import of the same module', () => {
        const imports = extension.get('./types') ?? [];

        expect(imports.map(entry => entry.cost.status)).toEqual(['type-only', 'bundled']);
    });

    it('reports an unused import that TypeScript removes as removed by the build', () => {
        expect(only(extension, 'unused-lib')).toMatchObject({ status: 'elided' });
    });

    it('counts the code of a side-effect import', () => {
        const cost = only(extension, 'side-effect-lib');

        expect(cost.status).toBe('bundled');
        expect(cost.status === 'bundled' ? cost.impact.bundledBytes : 0).toBe(bytesInOutput('node_modules/side-effect-lib/index.js'));
    });

    it('counts only the export of a tree-shakable package that is used', () => {
        const cost = only(extension, 'tree-lib');

        expect(cost.status === 'bundled' ? cost.impact.bundledBytes : -1).toBe(bytesInOutput('node_modules/tree-lib/used.js'));
        expect(bytesInOutput('node_modules/tree-lib/unused.js')).toBe(0);
    });

    it('flags a package bundled in two versions, as two instances', () => {
        const cost = only(extension, 'dup-lib');
        const duplicate = duplicatePackages(graph).find(candidate => candidate.name === 'dup-lib');

        expect(duplicate?.instances.map(instance => instance.version).sort()).toEqual(['1.0.0', '2.0.0']);
        expect(cost.status === 'bundled' ? cost.duplicate?.name : undefined).toBe('dup-lib');
        expect(cost.status === 'bundled' ? cost.package?.version : undefined).toBe('1.0.0');
    });

    it('includes the nested version a wrapper package pulls in', () => {
        const cost = only(extension, 'wrapper-lib');

        expect(cost.status).toBe('bundled');
        const names = cost.status === 'bundled' ? cost.impact.packages.map(share => share.name) : [];
        expect(names).toContain('dup-lib');
    });

    it('measures a package with a circular import without looping', () => {
        const cost = only(extension, 'circular-lib');
        const expected = bytesInOutput('node_modules/circular-lib/a.js') + bytesInOutput('node_modules/circular-lib/b.js');

        expect(cost.status === 'bundled' ? cost.impact.bundledBytes : -1).toBe(expected);
    });

    it('measures a module only this file imports as entirely exclusive', () => {
        const cost = only(extension, './helper');

        expect(cost.status === 'bundled' ? cost.impact.exclusiveBytes : -1).toBe(bytesInOutput('src/helper.ts'));
        expect(cost.status === 'bundled' ? cost.impact.sharedBytes : -1).toBe(0);
    });

    it('measures a module another file imports too as shared', () => {
        const cost = only(extension, './shared');

        expect(cost.status === 'bundled' ? cost.impact.exclusiveBytes : -1).toBe(0);
    });

    it('marks the dynamic import as lazy', () => {
        const cost = only(extension, './lazy');

        expect(cost).toMatchObject({ status: 'bundled', lazy: true });
    });
});

describe('the imports of src/legacy.js, a JavaScript file', () => {
    it('reports an unused package import as tree-shaken, not removed', () => {
        const legacy = attributeFile(graph, ESBUILD_FIXTURE, 'src/legacy.js');

        expect(only(legacy, 'shaken-lib')).toMatchObject({ status: 'tree-shaken' });
    });

    it('matches a require call to its CommonJS module', () => {
        const legacy = attributeFile(graph, ESBUILD_FIXTURE, 'src/legacy.js');
        const cost = only(legacy, 'cjs-lib');

        expect(cost.status).toBe('bundled');
        expect(cost.status === 'bundled' ? cost.match.edge.kind : undefined).toBe('require');
    });
});

describe('explaining why a module is in the build', () => {
    it('lists the import chains that reach a shared module', () => {
        const report = explainInclusion(graph, ['node_modules/big-library/lib/shared.js']);
        const importers = report.chains.map(chain => chain.steps[chain.steps.length - 2]?.moduleId);

        expect(report.reachable).toBe(true);
        expect(importers).toEqual(expect.arrayContaining(['node_modules/big-library/lib/parse.js', 'node_modules/big-library/lib/validate.js']));
        expect(report.chains.every(chain => chain.steps[0]?.moduleId === 'src/extension.ts')).toBe(true);
    });

    it('lists both importers of a package that two files import', () => {
        const instance = [...graph.packages().values()].find(candidate => candidate.name === 'big-library');
        const report = explainInclusion(graph, instance?.moduleIds ?? []);
        const importers = report.chains.map(chain => chain.steps[chain.steps.length - 2]?.moduleId).sort();

        expect(importers).toEqual(['src/commands.ts', 'src/extension.ts']);
    });
});

describe('a code-split ESM build of the same project', () => {
    it('puts the dynamic import in a lazily loaded chunk that is not an entry', async () => {
        const split = await buildEsbuildFixture({ format: 'esm', splitting: true, outfile: undefined, outdir: 'dist/esm' });
        const splitGraph = graphOf(normalizeEsbuildMetafile(split.metafile, { target: 'esm', createdAt: 1 }));
        const lazyChunk = splitGraph.snapshot.chunks.find(chunk => chunk.entryModule === 'src/lazy.ts');
        const cost = only(attributeFile(splitGraph, ESBUILD_FIXTURE, 'src/extension.ts'), './lazy');

        expect(splitGraph.entries).toEqual(['src/extension.ts']);
        expect(lazyChunk).toMatchObject({ entry: false, dynamicEntry: true });
        expect(cost).toMatchObject({ status: 'bundled', lazy: true });
        expect(cost.status === 'bundled' ? cost.impact.exclusiveBytes : -1).toBe(splitGraph.bytesOf('src/lazy.ts'));
    });
});
