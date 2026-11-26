import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { changeSetting, fireFileWatcher, openDocument, registeredProviders, setSetting, setWorkspaceFolders } from '../__mocks__/vscode';
import { activateExtension, cancellationToken, hintLabel, inlayHints, inlineCosts, preloadParser, settle, textDocument } from './support/extension';
import { EXTENSION_HOST_KEY, EXTENSION_HOST_METADATA, EXTENSION_SOURCE, extensionHostMetafile, writeExtensionHost } from './support/fixtures';
import { dynamicImport, esbuildMetafile, externalImport, requireCall, staticImport } from './support/metafile';
import { buildSnapshot, edge } from './support/snapshot';
import { lines, writeJson, writeSource } from './support/workspace';

import type { FakeTextDocument } from '../__mocks__/vscode';
import type { ActiveExtension } from './support/extension';

let extension: ActiveExtension | undefined;

async function activated(): Promise<ActiveExtension> {
    extension = await activateExtension();
    return extension;
}

beforeAll(preloadParser);

beforeEach(() => {
    setWorkspaceFolders('/w');
});

afterEach(() => {
    extension?.deactivate();
    extension = undefined;
});

describe('inline costs of an extension host build', () => {
    let document: FakeTextDocument;

    beforeEach(async () => {
        document = writeExtensionHost();
        await activated();
    });

    it('lists a cost at the end of each import, in document order', async () => {
        expect(await inlineCosts(document)).toEqual([
            ["import * as vscode from 'vscode';", 'external'],
            ["import { chunk } from 'lodash';", '72 kB bundled · 70 kB exclusive'],
            ["import { formatSize } from './format';", '3.1 kB bundled · 800 B exclusive'],
            ["import { log } from './log';", '300 B bundled · shared'],
            ["import { unusedHelper } from './unused';", '0 B · unused, removed by the build'],
            ["import { fresh } from 'fresh-package';", 'no build record'],
        ]);
    });

    it('labels an import the build leaves external as external', async () => {
        expect(await inlineCosts(document)).toContainEqual(["import * as vscode from 'vscode';", 'external']);
    });

    it('shows what a package adds with what it imports, and the part no other import needs', async () => {
        expect(await inlineCosts(document)).toContainEqual(["import { chunk } from 'lodash';", '72 kB bundled · 70 kB exclusive']);
    });

    it('marks an import as shared when other imports pull in all of its code too', async () => {
        expect(await inlineCosts(document)).toContainEqual(["import { log } from './log';", '300 B bundled · shared']);
    });

    it('says an import nothing uses was removed by the build', async () => {
        expect(await inlineCosts(document)).toContainEqual(["import { unusedHelper } from './unused';", '0 B · unused, removed by the build']);
    });

    it('says the build has no record of an import it does not know', async () => {
        expect(await inlineCosts(document)).toContainEqual(["import { fresh } from 'fresh-package';", 'no build record']);
    });

    it('hides type-only imports, and imports used only as types, by default', async () => {
        const statements = (await inlineCosts(document)).map(([statement]) => statement);

        expect(statements).not.toContain("import type { Options } from './options';");
        expect(statements).not.toContain("import { Shape } from './shapes';");
    });

    it('shows type-only imports, and imports used only as types, with display.typeOnly', async () => {
        changeSetting('trueImportCost.display.typeOnly', true);

        const costs = await inlineCosts(document);

        expect(costs).toContainEqual(["import type { Options } from './options';", '0 B · type-only']);
        expect(costs).toContainEqual(["import { Shape } from './shapes';", '0 B · used as a type only']);
    });

    it('leaves external imports unlabelled with display.external off', async () => {
        changeSetting('trueImportCost.display.external', false);

        expect((await inlineCosts(document)).map(([statement]) => statement)).not.toContain("import * as vscode from 'vscode';");
    });

    it('leaves out the exclusive part with display.exclusive off', async () => {
        changeSetting('trueImportCost.display.exclusive', false);

        const costs = await inlineCosts(document);

        expect(costs).toContainEqual(["import { chunk } from 'lodash';", '72 kB bundled']);
        expect(costs).toContainEqual(["import { log } from './log';", '300 B bundled']);
    });

    it('leaves imports the build has no record of unlabelled with display.unresolved off', async () => {
        changeSetting('trueImportCost.display.unresolved', false);

        expect((await inlineCosts(document)).map(([statement]) => statement)).not.toContain("import { fresh } from 'fresh-package';");
    });

    it('shows nothing with inline hints turned off', async () => {
        changeSetting('trueImportCost.inlayHints.enabled', false);

        expect(await inlayHints(document)).toEqual([]);
    });

    it('shows nothing with the extension turned off', async () => {
        changeSetting('trueImportCost.enabled', false);
        await settle();

        expect(await inlayHints(document)).toEqual([]);
    });

    it('lets a click on a bundled cost explain why it is included', async () => {
        const hint = (await inlayHints(document)).find(each => hintLabel(each).startsWith('72 kB'));
        const [part] = hint?.label as vscode.InlayHintLabelPart[];

        expect(part?.command).toEqual({
            title: 'Explain Why Included',
            command: 'trueImportCost.explainWhyIncluded',
            arguments: [{ target: EXTENSION_HOST_KEY, packageRoot: 'node_modules/lodash', label: 'lodash' }],
        });
        expect(part?.tooltip).toBe('Build target "extension-host". Click to see why it is included.');
        expect(hint?.paddingLeft).toBe(true);
    });

    it('explains a first-party module by its module id', async () => {
        const hint = (await inlayHints(document)).find(each => hintLabel(each).startsWith('3.1 kB'));
        const [part] = hint?.label as vscode.InlayHintLabelPart[];

        expect(part?.command?.arguments).toEqual([{ target: EXTENSION_HOST_KEY, modules: ['src/format.ts'], label: 'src/format.ts' }]);
    });

    it('gives an external import a tooltip but nothing to click', async () => {
        const hint = (await inlayHints(document)).find(each => hintLabel(each) === 'external');
        const [part] = hint?.label as vscode.InlayHintLabelPart[];

        expect(part?.command).toBeUndefined();
        expect(part?.tooltip).toBe('Build target "extension-host".');
    });

    it('returns only the hints inside the range it is asked for', async () => {
        const provider = registeredProviders('inlayHints')[0]?.provider as vscode.InlayHintsProvider;

        const hints = await provider.provideInlayHints(textDocument(document), new vscode.Range(1, 0, 2, 0), cancellationToken()) ?? [];

        expect(hints.map(hintLabel)).toEqual(['72 kB bundled · 70 kB exclusive']);
    });

    it('returns nothing once the request is cancelled', async () => {
        const provider = registeredProviders('inlayHints')[0]?.provider as vscode.InlayHintsProvider;
        const source = new vscode.CancellationTokenSource();
        source.cancel();

        expect(await provider.provideInlayHints(textDocument(document), new vscode.Range(0, 0, 20, 0), source.token)).toEqual([]);
    });
});

describe('inline costs of a changed document', () => {
    it('add that the source changed when the document has unsaved changes', async () => {
        setSetting('trueImportCost.analysis.debounceMs', 0);
        const document = writeExtensionHost();
        await activated();

        document.edit(EXTENSION_SOURCE.replace("'ready'", "'still ready'"));

        expect(await inlineCosts(document)).toEqual([
            ["import * as vscode from 'vscode';", 'external'],
            ["import { chunk } from 'lodash';", '72 kB bundled · 70 kB exclusive · source changed'],
            ["import { formatSize } from './format';", '3.1 kB bundled · 800 B exclusive · source changed'],
            ["import { log } from './log';", '300 B bundled · shared · source changed'],
            ["import { unusedHelper } from './unused';", '0 B · unused, removed by the build · source changed'],
            ["import { fresh } from 'fresh-package';", 'not in last build'],
        ]);
    });

    it('say an import added since the last build is not in it', async () => {
        setSetting('trueImportCost.analysis.debounceMs', 0);
        const document = writeExtensionHost();
        await activated();

        document.edit(`import { added } from 'added-package';\nadded();\n${EXTENSION_SOURCE}`);

        expect(await inlineCosts(document)).toContainEqual(["import { added } from 'added-package';", 'not in last build']);
    });

    it('add that the source changed when the file was saved after the build', async () => {
        const document = writeExtensionHost({ built: Date.now() - 60_000, saved: Date.now() });
        await activated();

        expect(await inlineCosts(document)).toContainEqual(["import { chunk } from 'lodash';", '72 kB bundled · 70 kB exclusive · source changed']);
    });

    it('do not count a file saved within a second of the build as changed', async () => {
        const built = Date.now();
        const document = writeExtensionHost({ built, saved: built + 900 });
        await activated();

        expect(await inlineCosts(document)).toContainEqual(["import { chunk } from 'lodash';", '72 kB bundled · 70 kB exclusive']);
    });

    it('follow a rebuild that rewrites the metadata', async () => {
        vi.useFakeTimers();
        const document = writeExtensionHost();
        await activated();
        const registration = registeredProviders('inlayHints')[0]!;
        const refreshes = registration.changes;

        writeJson(EXTENSION_HOST_METADATA, extensionHostMetafile(80_000));
        fireFileWatcher('changed', EXTENSION_HOST_METADATA);
        await vi.advanceTimersByTimeAsync(250);

        expect(registration.changes).toBeGreaterThan(refreshes);
        expect(await inlineCosts(document)).toContainEqual(["import { chunk } from 'lodash';", '82 kB bundled · 80 kB exclusive']);
    });
});

describe('inline costs of other builds', () => {
    it('prefix sizes a snapshot estimates with ~', async () => {
        writeJson('/w/web/.true-import-cost/webview.json', buildSnapshot({
            target: 'webview',
            root: '..',
            modules: [
                { path: 'src/main.ts', bytes: 900, precision: 'sourcemap-estimate', entry: true },
                { path: 'node_modules/vue/dist/vue.runtime.esm-bundler.js', bytes: 52_000, precision: 'sourcemap-estimate' },
            ],
            imports: [edge('src/main.ts', 'vue', 'node_modules/vue/dist/vue.runtime.esm-bundler.js')],
        }));
        const document = writeSource('/w/web/src/main.ts', lines("import { createApp } from 'vue';", "createApp({}).mount('#app');"));
        await activated();

        expect(await inlineCosts(document)).toEqual([["import { createApp } from 'vue';", '~52 kB bundled']]);
    });

    it('say a dynamic import loads its code lazily', async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 200, imports: [dynamicImport('./chart', 'src/chart.ts')] },
                'src/chart.ts': { output: 40_000, chunk: 'out/chart-QX3S.js' },
            },
            chunks: { 'out/chart-QX3S.js': 'src/chart.ts' },
        }));
        const document = writeSource('/w/src/main.ts', lines(
            'export async function open(): Promise<void> {',
            "    const { renderChart } = await import('./chart');",
            '    renderChart();',
            '}',
        ));
        await activated();

        expect(await inlineCosts(document)).toEqual([["const { renderChart } = await import('./chart')", '40 kB lazy']]);
    });

    it('add what a bundled import loads lazily', async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 200, imports: [staticImport('./charts', 'src/charts.ts')] },
                'src/charts.ts': { output: 1_000, imports: [dynamicImport('./chart-engine', 'src/chart-engine.ts')] },
                'src/chart-engine.ts': { output: 40_000, chunk: 'out/chart-engine-7RT2.js' },
            },
            chunks: { 'out/chart-engine-7RT2.js': 'src/chart-engine.ts' },
        }));
        const document = writeSource('/w/src/main.ts', lines("import { openChart } from './charts';", 'openChart();'));
        await activated();

        expect(await inlineCosts(document)).toEqual([["import { openChart } from './charts';", '1 kB bundled · +40 kB lazy']]);
    });

    it('say the build kept none of a package it resolved', async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 200, imports: [staticImport('lodash-es', 'node_modules/lodash-es/lodash.js')] },
                'node_modules/lodash-es/lodash.js': { output: 0 },
            },
        }));
        const document = writeSource('/w/src/main.ts', lines("import { debounce } from 'lodash-es';", 'export const later = debounce;'));
        await activated();

        expect(await inlineCosts(document)).toEqual([["import { debounce } from 'lodash-es';", '0 B · tree-shaken']]);
    });

    it('label the imports of a Vue single-file component, counting what its template uses', async () => {
        writeJson('/w/web/.true-import-cost/webview.json', buildSnapshot({
            target: 'webview',
            modules: [
                { path: 'src/main.ts', bytes: 300, entry: true },
                { path: 'src/App.vue', bytes: 1_200 },
                { path: 'src/components/Counter.vue', bytes: 3_000 },
                { path: 'node_modules/vue/dist/vue.runtime.esm-bundler.js', bytes: 52_000 },
            ],
            imports: [
                edge('src/main.ts', 'vue', 'node_modules/vue/dist/vue.runtime.esm-bundler.js'),
                edge('src/main.ts', './App.vue', 'src/App.vue'),
                edge('src/App.vue', 'vue', 'node_modules/vue/dist/vue.runtime.esm-bundler.js'),
                edge('src/App.vue', './components/Counter.vue', 'src/components/Counter.vue'),
            ],
        }));
        const document = writeSource('/w/web/src/App.vue', lines(
            '<script setup lang="ts">',
            "import { ref } from 'vue';",
            "import Counter from './components/Counter.vue';",
            '',
            'const count = ref(0);',
            '</script>',
            '',
            '<template>',
            '    <Counter :start="count" />',
            '</template>',
        ));
        await activated();

        expect(document.languageId).toBe('vue');
        expect(await inlineCosts(document)).toEqual([
            ["import { ref } from 'vue';", '52 kB bundled · shared'],
            ["import Counter from './components/Counter.vue';", '3 kB bundled'],
        ]);
    });

    it('label a require call in a JavaScript file', async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.js',
            inputs: {
                'src/main.js': { output: 200, imports: [requireCall('lodash', 'node_modules/lodash/lodash.js')] },
                'node_modules/lodash/lodash.js': { output: 70_000 },
            },
        }));
        const document = writeSource('/w/src/main.js', lines("const _ = require('lodash');", 'module.exports = _.chunk;'));
        await activated();

        expect(document.languageId).toBe('javascript');
        expect(await inlineCosts(document)).toEqual([["const _ = require('lodash');", '70 kB bundled']]);
    });

    it('never call an import kept for its side effects unused', async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 200, imports: [staticImport('./polyfills', 'src/polyfills.ts')] },
                'src/polyfills.ts': { output: 5_000 },
            },
        }));
        const document = writeSource('/w/src/main.ts', lines("import './polyfills';", "import './theme.css';"));
        await activated();

        expect(await inlineCosts(document)).toEqual([
            ["import './polyfills';", '5 kB bundled'],
            ["import './theme.css';", 'no build record'],
        ]);
    });

    it('say an external import the build dropped was removed', async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: { 'src/main.ts': { output: 200, imports: [externalImport('node:fs')] } },
            retainedExternals: [],
        }));
        const document = writeSource('/w/src/main.ts', lines("import { readFileSync } from 'node:fs';", 'export const read = readFileSync;'));
        await activated();

        expect(await inlineCosts(document)).toEqual([["import { readFileSync } from 'node:fs';", '0 B · unused, removed by the build']]);
    });

    it('are not shown for a document no build contains', async () => {
        writeExtensionHost();
        const document = writeSource('/w/scripts/release.ts', lines("import { chunk } from 'lodash';", 'chunk([], 1);'));
        await activated();

        expect(await inlayHints(document)).toEqual([]);
    });

    it('are not asked for in a language the extension does not support', async () => {
        writeExtensionHost();
        await activated();
        const json = openDocument('/w/src/data.json', '{ "import": "lodash" }');

        expect(await inlayHints(json)).toEqual([]);
        expect(registeredProviders('inlayHints')[0]?.selector).toEqual(['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'].map(language => ({ language })));
    });
});
