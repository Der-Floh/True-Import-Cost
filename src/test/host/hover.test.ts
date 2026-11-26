import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { changeSetting, setWorkspaceFolders } from '../__mocks__/vscode';
import { activateExtension, commandLinkArguments, hoverAt, liveCommandLinks, markdownOf, preloadParser } from './support/extension';
import { EXTENSION_HOST_KEY, EXTENSION_SOURCE, writeDuplicatedLodash, writeExtensionHost } from './support/fixtures';
import { esbuildMetafile, externalImport, staticImport } from './support/metafile';
import { buildSnapshot, edge } from './support/snapshot';
import { lines, writeJson, writePackageJson, writeSource } from './support/workspace';

import type { FakeTextDocument } from '../__mocks__/vscode';
import type { ActiveExtension } from './support/extension';

let extension: ActiveExtension | undefined;

async function activated(): Promise<void> {
    extension = await activateExtension();
}

async function hoverMarkdown(document: FakeTextDocument, needle: string): Promise<string> {
    return markdownOf(await hoverAt(document, needle)).value;
}

beforeAll(preloadParser);

beforeEach(() => {
    setWorkspaceFolders('/w');
});

afterEach(() => {
    extension?.deactivate();
    extension = undefined;
});

describe('hovering a bundled import', () => {
    let document: FakeTextDocument;

    beforeEach(async () => {
        document = writeExtensionHost();
        await activated();
    });

    it('names the package, its version and the build target', async () => {
        const [title, target] = (await hoverMarkdown(document, 'lodash')).split('\n');

        expect(title).toBe('**`lodash`** 4\\.17\\.21');
        expect(target).toBe('`extension-host` · esbuild');
    });

    it('tabulates what the import costs', async () => {
        expect(await hoverMarkdown(document, 'lodash')).toContain([
            '| | |',
            '|:--|--:|',
            '| Bundled, with what it imports | 72 kB |',
            '| Exclusive to this import | 70 kB |',
            '| Shared with other imports | 2 kB |',
            '| Whole package in this build | 70 kB |',
            '| Modules retained | 2 of 2 |',
        ].join('\n'));
    });

    it('leaves the package row out for a module of the project', async () => {
        const markdown = await hoverMarkdown(document, './format');

        expect(markdown.split('\n')[0]).toBe('**`src/format.ts`**');
        expect(markdown).toContain('| Bundled, with what it imports | 3\\.1 kB |');
        expect(markdown).toContain('| Modules retained | 3 of 3 |');
        expect(markdown).not.toContain('Whole package');
    });

    it('names the other packages the import pulls in', async () => {
        expect(await hoverMarkdown(document, 'lodash')).toContain('Pulls in `tslib` 2 kB');
    });

    it('says how the sizes were measured, how the import was matched and when the build ran', async () => {
        const markdown = await hoverMarkdown(document, 'lodash');

        expect(markdown).toContain('Sizes: reported by the bundler  \n');
        expect(markdown).toContain('Matched by the import as the bundler resolved it  \n');
        expect(markdown).toContain('Built just now');
    });

    it('links to the explanation of why the package is included', async () => {
        const markdown = await hoverMarkdown(document, 'lodash');

        expect(liveCommandLinks(markdown)).toEqual(['trueImportCost.explainWhyIncluded']);
        expect(commandLinkArguments(markdown, 'trueImportCost.explainWhyIncluded')).toEqual([
            { target: EXTENSION_HOST_KEY, packageRoot: 'node_modules/lodash', label: 'lodash' },
        ]);
    });

    it('trusts only the explain command, and renders theme icons', async () => {
        const markdown = markdownOf(await hoverAt(document, 'lodash'));

        expect(markdown.isTrusted).toEqual({ enabledCommands: ['trueImportCost.explainWhyIncluded'] });
        expect(markdown.supportThemeIcons).toBe(true);
    });

    it('covers the whole import statement', async () => {
        const hover = await hoverAt(document, 'chunk');

        expect(hover?.range).toEqual(new vscode.Range(1, 0, 1, 31));
    });

    it('describes how each imported binding is used', async () => {
        expect(await hoverMarkdown(document, 'lodash')).toContain('**Usage** · `chunk`: called once');
        expect(await hoverMarkdown(document, 'vscode')).toContain('**Usage** · `vscode`: `window`');
    });

    it('leaves the usage out with usage analysis off', async () => {
        changeSetting('trueImportCost.analysis.usageAnalysis', false);

        expect(await hoverMarkdown(document, 'lodash')).not.toContain('**Usage**');
    });

    it('shows nothing outside an import', async () => {
        expect(await hoverAt(document, 'export function activate')).toBeUndefined();
    });

    it('shows nothing with the extension turned off', async () => {
        changeSetting('trueImportCost.enabled', false);

        expect(await hoverAt(document, 'lodash')).toBeUndefined();
    });
});

describe('hovering an import that is not bundled', () => {
    let document: FakeTextDocument;

    beforeEach(async () => {
        document = writeExtensionHost();
        await activated();
    });

    it('explains that the build leaves an external import to the runtime', async () => {
        const markdown = await hoverMarkdown(document, "'vscode'");

        expect(markdown).toContain('**`vscode`**\n`extension-host` · esbuild\n\nThe build leaves this import external: it is loaded at runtime, not bundled.');
        expect(liveCommandLinks(markdown)).toEqual([]);
    });

    it('explains that the build dropped an import nothing uses', async () => {
        expect(await hoverMarkdown(document, './unused')).toContain('The build dropped this import: nothing uses it as a value, so compilation removed it.');
    });

    it('explains that the build has no record of an import', async () => {
        expect(await hoverMarkdown(document, 'fresh-package')).toContain('The build metadata has no record of this import.');
    });

    it('explains that an unknown import may be newer than the build once the source changed', async () => {
        changeSetting('trueImportCost.analysis.debounceMs', 0);
        document.edit(EXTENSION_SOURCE.replace("'ready'", "'set'"));

        const markdown = await hoverMarkdown(document, 'fresh-package');

        expect(markdown).toContain('This import is newer than the last build, or the build no longer contains it.');
        expect(markdown).toContain('$(history) source changed since');
    });
});

describe('hovering an import several builds contain', () => {
    it('lists what it costs in the other build targets', async () => {
        const document = writeExtensionHost();
        writeJson('/w/.true-import-cost/web.json', esbuildMetafile({
            entry: 'src/extension.ts',
            inputs: {
                'src/extension.ts': { output: 900, imports: [externalImport('vscode'), staticImport('lodash', 'node_modules/lodash/lodash.js')] },
                'node_modules/lodash/lodash.js': { output: 40_000 },
            },
        }));
        await activated();

        expect(await hoverMarkdown(document, 'lodash')).toContain('Other targets: `web` 40 kB bundled');
        expect(await hoverMarkdown(document, "'vscode'")).toContain('Other targets: `web` external');
    });
});

describe('hovering an import of an estimated build', () => {
    it('marks the sizes as estimates and says how they were estimated', async () => {
        writeJson('/w/web/.true-import-cost/webview.json', buildSnapshot({
            target: 'webview',
            mode: 'production',
            modules: [
                { path: 'src/main.ts', bytes: 900, precision: 'sourcemap-estimate', entry: true },
                { path: 'node_modules/vue/dist/vue.runtime.esm-bundler.js', bytes: 52_000, precision: 'sourcemap-estimate' },
            ],
            imports: [edge('src/main.ts', 'vue', 'node_modules/vue/dist/vue.runtime.esm-bundler.js')],
        }));
        const document = writeSource('/w/web/src/main.ts', lines("import { createApp } from 'vue';", "createApp({}).mount('#app');"));
        await activated();

        const markdown = await hoverMarkdown(document, 'vue');

        expect(markdown.split('\n')[1]).toBe('`webview` · vite 8\\.3\\.8 \\(rolldown\\) · production');
        expect(markdown).toContain('| Bundled, with what it imports | \\~52 kB |');
        expect(markdown).toContain('Sizes: estimated from the production source maps');
    });
});

describe('hovering an import of a duplicated package', () => {
    it('lists every copy of the package in the build', async () => {
        const document = writeDuplicatedLodash();
        await activated();

        expect(await hoverMarkdown(document, 'lodash')).toContain(
            '$(warning) `lodash` is bundled 2 times: 4\\.17\\.21 (70 kB, `node_modules/lodash`), 3\\.10\\.1 (60 kB, `node_modules/legacy-widget/node_modules/lodash`)',
        );
    });
});

describe('hovering an import of a package with a hostile name', () => {
    const NAME = 'x`](command:workbench.action.terminal.new)[y';
    const VERSION = '1.0.0](command:workbench.action.reloadWindow)';

    let document: FakeTextDocument;

    beforeEach(async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 100, imports: [staticImport(NAME, `node_modules/${NAME}/index.js`)] },
                [`node_modules/${NAME}/index.js`]: { output: 2_000 },
            },
        }));
        writePackageJson(`/w/node_modules/${NAME}`, VERSION);
        document = writeSource('/w/src/main.ts', lines(`import evil from '${NAME}';`, 'evil();'));
        await activated();
    });

    it('keeps the name inside a code span and escapes the version', async () => {
        const [title] = (await hoverMarkdown(document, 'evil')).split('\n');

        expect(title).toBe('**`x ](command:workbench.action.terminal.new)[y`** 1\\.0\\.0\\]\\(command:workbench\\.action\\.reloadWindow\\)');
    });

    it('links to no command but the explain command', async () => {
        const markdown = markdownOf(await hoverAt(document, 'evil'));

        expect(liveCommandLinks(markdown.value)).toEqual(['trueImportCost.explainWhyIncluded']);
        expect(markdown.isTrusted).toEqual({ enabledCommands: ['trueImportCost.explainWhyIncluded'] });
    });

    it('passes the name to the explain command intact', async () => {
        const markdown = await hoverMarkdown(document, 'evil');

        expect(commandLinkArguments(markdown, 'trueImportCost.explainWhyIncluded')).toEqual([
            { target: vscode.Uri.file('/w/.true-import-cost/app.json').toString(), packageRoot: `node_modules/${NAME}`, label: NAME },
        ]);
    });
});
