import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vue from '@vitejs/plugin-vue';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attributeFile, graphOf, only, VITE_FIXTURE } from './support';
import { parseSnapshot } from '../../core/schema/validate';
import { trueImportCost } from '../../plugins/vite';

import type { AttributedImport } from './support';
import type { BuildGraph } from '../../core/graph/buildGraph';
import type { BuildSnapshot } from '../../core/schema/snapshot';
import type { InlineConfig } from 'vite';

const outDirs: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-vite-'));
    outDirs.push(directory);
    return directory;
}

async function buildFixture(outDir: string, overrides: InlineConfig['build'] = {}, target = 'webview'): Promise<void> {
    await build({
        root: VITE_FIXTURE,
        configFile: false,
        logLevel: 'silent',
        plugins: [vue(), trueImportCost({ target, outDir })],
        build: { write: false, ...overrides },
    });
}

function readSnapshot(file: string): BuildSnapshot {
    const result = parseSnapshot(JSON.parse(readFileSync(file, 'utf8')));
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.snapshot;
}

let outDir: string;
let snapshot: BuildSnapshot;
let graph: BuildGraph;
let app: Map<string, AttributedImport[]>;
let main: Map<string, AttributedImport[]>;

beforeAll(async () => {
    outDir = temporaryDirectory();
    await buildFixture(outDir);
    snapshot = readSnapshot(path.join(outDir, 'webview.json'));
    graph = graphOf(snapshot);
    app = attributeFile(graph, VITE_FIXTURE, 'src/App.vue');
    main = attributeFile(graph, VITE_FIXTURE, 'src/main.ts');
});

afterAll(() => {
    for (const directory of outDirs) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('the Vite plugin on a Vue webview', () => {
    it('writes a valid snapshot named after the target, rooted at the Vite root', () => {
        expect(snapshot.target).toBe('webview');
        expect(snapshot.mode).toBe('production');
        expect(snapshot.bundler.name).toBe('vite');
        expect(snapshot.bundler.version).toMatch(/^\d+\.\d+\.\d+/);
        expect(path.resolve(outDir, snapshot.root)).toBe(VITE_FIXTURE);
    });

    it('takes the HTML page as the entry point', () => {
        expect(graph.entries).toEqual(['index.html']);
    });

    it('fills in package versions', () => {
        const instance = [...graph.packages().values()].find(candidate => candidate.name === 'big-library');

        expect(instance?.version).toBe('3.2.0');
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

    it('splits the CSS asset across the stylesheet and the components\' style blocks', () => {
        const css = snapshot.chunks.find(chunk => chunk.kind === 'css');
        const contributors = snapshot.modules.filter(module => module.contributions.some(contribution => contribution.chunkId === css?.id));
        const total = contributors.reduce((sum, module) => sum + graph.bytesOf(module.id), 0);

        expect(contributors.map(module => module.path).sort()).toEqual(['src/App.vue', 'src/components/Hello.vue', 'src/style.css']);
        expect(Math.abs(total - (css?.bytes ?? 0))).toBeLessThanOrEqual(contributors.length);
    });
});

describe('the imports of App.vue against that build', () => {
    it('measures vue, which main.ts imports too, as shared', () => {
        const cost = only(app, 'vue');

        expect(cost.status).toBe('bundled');
        expect(cost.status === 'bundled' ? cost.impact.exclusiveBytes : -1).toBe(0);
        expect(cost.status === 'bundled' ? cost.match.confidence : undefined).toBe('resolved');
    });

    it('measures a package only App.vue imports as exclusive, without the export it does not use', () => {
        const cost = only(app, 'big-library');
        const validate = graph.bytesOf('node_modules/big-library/lib/validate.js');

        expect(cost.status).toBe('bundled');
        expect(cost.status === 'bundled' ? cost.impact.exclusiveBytes : -1).toBe(cost.status === 'bundled' ? cost.impact.bundledBytes : -2);
        expect(validate).toBe(0);
    });

    it('counts a component\'s own code as exclusive and the framework it uses as shared', () => {
        const cost = only(app, './components/Hello.vue');

        expect(cost.status).toBe('bundled');
        if (cost.status === 'bundled') {
            expect(cost.impact.exclusiveBytes).toBeGreaterThan(0);
            expect(cost.impact.sharedBytes).toBeGreaterThan(cost.impact.exclusiveBytes);
        }
    });

    it('recognises a directive used only in the template', () => {
        expect(only(app, './directives/focus').status).toBe('bundled');
    });

    it('reports a component nothing renders as removed by the build', () => {
        expect(only(app, './components/Unused.vue')).toMatchObject({ status: 'elided' });
    });

    it('erases a type-only import', () => {
        expect(only(app, './types')).toMatchObject({ status: 'type-only' });
    });

    it('measures the lazily loaded component in its own chunk', () => {
        const cost = only(app, './components/Lazy.vue');
        const chunk = snapshot.chunks.find(candidate => candidate.entryModule === 'src/components/Lazy.vue');

        expect(cost).toMatchObject({ status: 'bundled', lazy: true });
        expect(chunk).toMatchObject({ dynamicEntry: true, entry: false });
    });
});

describe('the imports of main.ts against that build', () => {
    it('measures a stylesheet import in CSS bytes', () => {
        const cost = only(main, './style.css');

        expect(cost.status).toBe('bundled');
        if (cost.status === 'bundled') {
            expect(cost.impact.bundledBytes).toBeGreaterThan(0);
            expect(cost.impact.precision).toBe('proportional-estimate');
        }
    });
});

describe('other build configurations', () => {
    it('estimates module sizes from source maps when the build writes them', async () => {
        const directory = temporaryDirectory();
        await buildFixture(directory, { sourcemap: 'hidden' });
        const mapped = readSnapshot(path.join(directory, 'webview.json'));
        const precisions = new Set(mapped.modules.flatMap(module => module.contributions.map(contribution => contribution.precision)));

        expect(precisions).toContain('sourcemap-estimate');
    });

    it('writes one snapshot per output when a build has several', async () => {
        const directory = temporaryDirectory();
        await buildFixture(directory, {
            lib: { entry: path.join(VITE_FIXTURE, 'src/directives/focus.ts'), formats: ['es', 'cjs'], fileName: 'focus' },
        }, 'library');

        expect(readdirSync(directory).filter(file => file.endsWith('.json')).sort()).toEqual(['library.cjs.json', 'library.json']);
    });
});
