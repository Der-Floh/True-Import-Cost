import { describe, expect, it } from 'vitest';

import { fixture, inPackage } from './support/snapshot';
import { explainInclusion } from '../../core/graph/whyIncluded';

import type { InclusionChain } from '../../core/graph/whyIncluded';

function names(chain: InclusionChain | undefined): string[] {
    return (chain?.steps ?? []).map(step => (step.via === undefined ? step.moduleId : `${step.via}:${step.moduleId}`));
}

describe('explainInclusion', () => {
    it('explains a module by the import chain from an entry point', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/app.ts', 10)
            .module('src/widget.ts', 10)
            .module('src/chart.ts', 10)
            .imports('src/main.ts', 'src/app.ts')
            .imports('src/app.ts', 'src/widget.ts')
            .imports('src/widget.ts', 'src/chart.ts')
            .graph();

        expect(explainInclusion(graph, ['src/chart.ts'])).toEqual({
            reachable: true,
            directImporters: 1,
            chains: [{
                steps: [
                    { moduleId: 'src/main.ts' },
                    { moduleId: 'src/app.ts', via: 'static' },
                    { moduleId: 'src/widget.ts', via: 'static' },
                    { moduleId: 'src/chart.ts', via: 'static' },
                ],
            }],
        });
    });

    it('gives one chain per direct importer, shortest first, each along a shortest path', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/deep.ts', 10)
            .module('src/deeper.ts', 10)
            .module('src/near.ts', 10)
            .module('src/chart.ts', 10)
            .imports('src/main.ts', 'src/deep.ts')
            .imports('src/deep.ts', 'src/deeper.ts')
            .imports('src/deeper.ts', 'src/chart.ts')
            .imports('src/main.ts', 'src/near.ts')
            .imports('src/near.ts', 'src/chart.ts')
            .imports('src/main.ts', 'src/deeper.ts')
            .graph();

        const report = explainInclusion(graph, ['src/chart.ts']);

        expect(report.chains.map(names)).toEqual([
            ['src/main.ts', 'static:src/deeper.ts', 'static:src/chart.ts'],
            ['src/main.ts', 'static:src/near.ts', 'static:src/chart.ts'],
        ]);
        expect(report.directImporters).toBe(2);
    });

    it('records how each step was imported', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/router.ts', 10)
            .module('src/page.ts', 10)
            .module('src/legacy.cjs', 10)
            .module('src/page.css', 10)
            .imports('src/main.ts', 'src/router.ts')
            .imports('src/router.ts', 'src/page.ts', { kind: 'dynamic' })
            .imports('src/page.ts', 'src/legacy.cjs', { kind: 'require' })
            .imports('src/legacy.cjs', 'src/page.css', { kind: 'css' })
            .graph();

        expect(names(explainInclusion(graph, ['src/page.css']).chains[0]))
            .toEqual(['src/main.ts', 'static:src/router.ts', 'dynamic:src/page.ts', 'require:src/legacy.cjs', 'css:src/page.css']);
    });

    it('shows an entry point as a chain of its own', () => {
        const graph = fixture().module('src/main.ts', 10, { entry: true }).graph();

        expect(explainInclusion(graph, ['src/main.ts'])).toEqual({ reachable: true, directImporters: 0, chains: [{ steps: [{ moduleId: 'src/main.ts' }] }] });
    });

    it('starts chains at whichever entry point reaches the importer', () => {
        const graph = fixture()
            .module('src/web.ts', 10, { entry: true })
            .module('src/worker.ts', 10, { entry: true })
            .module('src/codec.ts', 10)
            .imports('src/worker.ts', 'src/codec.ts')
            .graph();

        expect(explainInclusion(graph, ['src/codec.ts']).chains.map(names)).toEqual([['src/worker.ts', 'static:src/codec.ts']]);
    });

    it('reports a module no entry point reaches as unreachable but still counts its importers', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/dead.ts', 10)
            .module('src/util.ts', 10)
            .imports('src/dead.ts', 'src/util.ts')
            .graph();

        expect(explainInclusion(graph, ['src/util.ts'])).toEqual({ reachable: false, chains: [], directImporters: 1 });
    });

    it('does not follow externals or asset references', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/style.css', 10)
            .module('src/font.woff2', 10)
            .imports('src/main.ts', 'src/style.css', { kind: 'css' })
            .imports('src/style.css', 'src/font.woff2', { kind: 'reference' })
            .external('src/main.ts', 'vscode', { retained: true })
            .graph();

        expect(explainInclusion(graph, ['src/font.woff2'])).toEqual({ reachable: false, chains: [], directImporters: 0 });
    });

    it('explains a whole package at once, counting each importer once and skipping imports inside the package', () => {
        const lib = inPackage('lib');
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/a.ts', 10)
            .module('src/b.ts', 10)
            .module('node_modules/lib/index.js', 10, lib)
            .module('node_modules/lib/util.js', 10, lib)
            .imports('src/main.ts', 'src/a.ts')
            .imports('src/main.ts', 'src/b.ts')
            .imports('src/a.ts', 'node_modules/lib/index.js')
            .imports('src/b.ts', 'node_modules/lib/index.js')
            .imports('src/b.ts', 'node_modules/lib/util.js')
            .imports('node_modules/lib/index.js', 'node_modules/lib/util.js')
            .graph();

        const report = explainInclusion(graph, ['node_modules/lib/index.js', 'node_modules/lib/util.js']);

        expect(report.directImporters).toBe(2);
        expect(report.chains.map(names)).toEqual([
            ['src/main.ts', 'static:src/a.ts', 'static:node_modules/lib/index.js'],
            ['src/main.ts', 'static:src/b.ts', 'static:node_modules/lib/index.js'],
        ]);
    });

    it('returns at most the requested number of chains', () => {
        const builder = fixture().module('src/main.ts', 10, { entry: true }).module('src/target.ts', 10);
        for (let index = 0; index < 5; index++) {
            builder.module(`src/importer-${index}.ts`, 10).imports('src/main.ts', `src/importer-${index}.ts`).imports(`src/importer-${index}.ts`, 'src/target.ts');
        }

        const report = explainInclusion(builder.graph(), ['src/target.ts'], 3);

        expect(report.chains).toHaveLength(3);
        expect(report.directImporters).toBe(5);
    });

    it('terminates on circular imports', () => {
        const graph = fixture()
            .module('src/main.ts', 10, { entry: true })
            .module('src/a.ts', 10)
            .module('src/b.ts', 10)
            .imports('src/main.ts', 'src/a.ts')
            .imports('src/a.ts', 'src/b.ts')
            .imports('src/b.ts', 'src/a.ts')
            .graph();

        const report = explainInclusion(graph, ['src/b.ts']);

        expect(report).toMatchObject({ reachable: true, directImporters: 1 });
        expect(report.chains.map(names)).toEqual([['src/main.ts', 'static:src/a.ts', 'static:src/b.ts']]);
    });

    it('caps very long chains, keeping the end that leads to the module', () => {
        const builder = fixture().module('m0', 1, { entry: true });
        for (let index = 1; index <= 100; index++) {
            builder.module(`m${index}`, 1).imports(`m${index - 1}`, `m${index}`);
        }

        const chain = explainInclusion(builder.graph(), ['m100']).chains[0];

        expect(chain?.steps).toHaveLength(65);
        expect(names(chain).slice(-2)).toEqual(['static:m99', 'static:m100']);
    });

    it('ignores targets that are not modules of the build', () => {
        const graph = fixture().module('src/main.ts', 10, { entry: true }).graph();

        expect(explainInclusion(graph, ['src/gone.ts'])).toEqual({ reachable: false, chains: [], directImporters: 0 });
    });
});
