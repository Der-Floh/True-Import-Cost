import { beforeAll, describe, expect, it } from 'vitest';

import { attributeFile, BARRELS_FIXTURE, buildEsbuildFixture, graphOf, only } from './support';
import { normalizeEsbuildMetafile } from '../../core/adapters/esbuild';
import { importImpact } from '../../core/graph/impact';

import type { AttributedImport } from './support';
import type { ImportCost, ModuleCost } from '../../core/attribution/attribute';
import type { BuildGraph } from '../../core/graph/buildGraph';
import type { Metafile } from 'esbuild';

let metafile: Metafile;
let graph: BuildGraph;
let main: Map<string, AttributedImport[]>;

function bytesInOutput(...inputPaths: string[]): number {
    return inputPaths.reduce((total, inputPath) =>
        total + Object.values(metafile.outputs).reduce((sum, output) => sum + (output.inputs[inputPath]?.bytesInOutput ?? 0), 0), 0);
}

function bundled(cost: ImportCost): ModuleCost {
    if (cost.status !== 'bundled') {
        throw new Error(`expected a bundled import, got ${cost.status}`);
    }
    return cost;
}

beforeAll(async () => {
    metafile = (await buildEsbuildFixture({ absWorkingDir: BARRELS_FIXTURE, entryPoints: ['src/main.ts'], external: [], outfile: 'dist/main.js' })).metafile;
    graph = graphOf(normalizeEsbuildMetafile(metafile, { target: 'main', createdAt: 1 }));
    main = attributeFile(graph, BARRELS_FIXTURE, 'src/main.ts');
});

describe('a named import of a package barrel in a real esbuild build', () => {
    it('is charged with the modules that define what it uses, with what they import', () => {
        const cost = bundled(only(main, 'kit'));

        expect(cost.barrel?.definers).toEqual(['node_modules/kit/debounce.js', 'node_modules/kit/strings/capitalize.js', 'node_modules/kit/theme.js']);
        expect(cost.barrel?.passThrough).toEqual(['node_modules/kit/index.js', 'node_modules/kit/strings/index.js']);
        expect(cost.impact.bundledBytes).toBe(bytesInOutput(
            'node_modules/kit/debounce.js',
            'node_modules/kit/now.js',
            'node_modules/kit/strings/capitalize.js',
            'node_modules/kit/theme.js',
            'node_modules/kit/register.js',
        ));
    });

    it('narrows on the bindings used as values, and follows a re-exported default', () => {
        expect(bundled(only(main, 'kit')).barrel?.names).toEqual(['default', 'capitalize', 'debounce']);
    });

    it('keeps the side-effect import of the barrel itself', () => {
        expect(bundled(only(main, 'kit')).barrel?.eagerRoots).toContain('node_modules/kit/register.js');
        expect(bytesInOutput('node_modules/kit/register.js')).toBeGreaterThan(0);
    });

    it('leaves out an export the build kept only for another file', () => {
        const cost = bundled(only(main, 'kit'));
        const wholeBarrel = importImpact(graph, ['src/main.ts'], 'node_modules/kit/index.js');

        expect(bytesInOutput('node_modules/kit/throttle.js')).toBeGreaterThan(0);
        expect(wholeBarrel.bundledBytes - cost.impact.bundledBytes).toBe(bytesInOutput('node_modules/kit/throttle.js'));
    });

    it('counts what another file reaches without the barrel as shared, and the rest as exclusive', () => {
        const { impact } = bundled(only(main, 'kit'));

        expect(impact.exclusiveBytes).toBe(bytesInOutput('node_modules/kit/strings/capitalize.js', 'node_modules/kit/theme.js', 'node_modules/kit/register.js'));
        expect(impact.sharedBytes).toBe(bytesInOutput('node_modules/kit/debounce.js', 'node_modules/kit/now.js'));
    });
});

describe('a named import of a project barrel that another file imports too', () => {
    it('follows export * through a nested barrel to the definitions', () => {
        const cost = bundled(only(main, './components'));

        expect(cost.barrel?.definers).toEqual(['src/components/Button.ts', 'src/components/forms/Input.ts']);
        expect(cost.impact.bundledBytes).toBe(bytesInOutput('src/components/Button.ts', 'src/components/forms/Input.ts'));
        expect(importImpact(graph, ['src/main.ts'], 'src/components/index.ts').bundledBytes)
            .toBe(cost.impact.bundledBytes + bytesInOutput('src/components/Card.ts', 'src/components/forms/Select.ts'));
    });

    it('counts all of it as shared, since the other file may use the same exports', () => {
        const { impact } = bundled(only(main, './components'));

        expect(impact.exclusiveBytes).toBe(0);
        expect(impact.sharedBytes).toBe(impact.bundledBytes);
    });
});

describe('a named import of a CommonJS barrel', () => {
    it('keeps the cost of the whole module, since its exports cannot be traced', () => {
        const cost = bundled(only(main, 'cjs-kit'));

        expect(cost).not.toHaveProperty('barrel');
        expect(cost.impact.bundledBytes).toBe(bytesInOutput('node_modules/cjs-kit/index.js', 'node_modules/cjs-kit/alpha.js', 'node_modules/cjs-kit/beta.js'));
    });
});
