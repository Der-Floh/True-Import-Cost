import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { changeSetting, fireFileWatcher, flushFileReads, setVirtualFile, setWorkspaceFolders } from '../__mocks__/vscode';
import { activateExtension, diagnosticsOf, hoverAt, inlineCosts, markdownOf, preloadParser, settle } from './support/extension';
import { esbuildMetafile, staticImport } from './support/metafile';
import { lines, writeJson, writePackageJson, writeSource } from './support/workspace';

import type { FakeTextDocument } from '../__mocks__/vscode';
import type { ActiveExtension } from './support/extension';
import type { EsbuildMetafile } from './support/metafile';

const METADATA = '/w/.true-import-cost/app.json';

const KIT_IMPORT = "import { debounce, throttle } from 'kit';";

const MAIN_SOURCE = lines(
    KIT_IMPORT,
    "import { log } from './log';",
    "import './settings';",
    '',
    'log(debounce(() => 1));',
);

const BARREL = lines(
    "export { debounce } from './debounce.js';",
    "export { throttle } from './throttle.js';",
    "export * from './strings.js';",
);

const BARREL_FILES = ['/w/node_modules/kit/debounce.js', '/w/node_modules/kit/index.js'];

function kitMetafile(debounceBytes = 2_000): EsbuildMetafile {
    return esbuildMetafile({
        entry: 'src/main.ts',
        inputs: {
            'src/main.ts': {
                output: 300,
                imports: [staticImport('kit', 'node_modules/kit/index.js'), staticImport('./log', 'src/log.ts'), staticImport('./settings', 'src/settings.ts')],
            },
            'src/log.ts': { output: 100 },
            'src/settings.ts': { output: 200, imports: [staticImport('kit/throttle.js', 'node_modules/kit/throttle.js')] },
            'node_modules/kit/index.js': {
                output: 0,
                imports: [
                    staticImport('./debounce.js', 'node_modules/kit/debounce.js'),
                    staticImport('./throttle.js', 'node_modules/kit/throttle.js'),
                    staticImport('./strings.js', 'node_modules/kit/strings.js'),
                ],
            },
            'node_modules/kit/debounce.js': { output: debounceBytes },
            'node_modules/kit/throttle.js': { output: 3_000 },
            'node_modules/kit/strings.js': { output: 500 },
        },
    });
}

function writeKit(source = MAIN_SOURCE): FakeTextDocument {
    writeJson(METADATA, kitMetafile());
    writePackageJson('/w/node_modules/kit', '1.0.0');
    setVirtualFile('/w/node_modules/kit/index.js', BARREL);
    setVirtualFile('/w/node_modules/kit/debounce.js', 'export function debounce(callback) { return callback; }\n');
    setVirtualFile('/w/node_modules/kit/throttle.js', 'export function throttle(callback) { return callback; }\n');
    setVirtualFile('/w/node_modules/kit/strings.js', 'export function kebab(text) { return text; }\n');
    setVirtualFile('/w/src/log.ts', 'export function log(value: unknown): void { console.log(value); }\n');
    setVirtualFile('/w/src/settings.ts', "import { throttle } from 'kit/throttle.js';\nexport const settings = throttle(() => 1);\n");
    return writeSource('/w/src/main.ts', source);
}

function sourcesRead(): string[] {
    return flushFileReads().filter(path => /\.(js|ts)$/.test(path)).sort();
}

async function costOf(document: FakeTextDocument, statement: string): Promise<string | undefined> {
    return (await inlineCosts(document)).find(([line]) => line === statement)?.[1];
}

let extension: ActiveExtension | undefined;

async function activated(): Promise<void> {
    extension = await activateExtension();
    await settle();
}

beforeAll(preloadParser);

beforeEach(() => {
    setWorkspaceFolders('/w');
});

afterEach(() => {
    extension?.deactivate();
    extension = undefined;
    vi.useRealTimers();
});

describe('import costs traced through a barrel', () => {
    let document: FakeTextDocument;

    beforeEach(async () => {
        document = writeKit();
        await activated();
    });

    it('charge a named import with the module that defines the name it uses, not the whole barrel', async () => {
        const costs = await inlineCosts(document);

        expect(costs).toContainEqual([KIT_IMPORT, '2 kB bundled']);
        expect(costs).toContainEqual(["import { log } from './log';", '100 B bundled']);
    });

    it('charge every imported name with usage analysis off', async () => {
        changeSetting('trueImportCost.analysis.usageAnalysis', false);

        expect(await costOf(document, KIT_IMPORT)).toBe('5 kB bundled · 2 kB exclusive');
    });

    it('say in the hover that the cost was traced through the barrel, and to which module', async () => {
        const markdown = markdownOf(await hoverAt(document, 'debounce,')).value;

        expect(markdown).toContain('| Bundled, with what it imports | 2 kB |');
        expect(markdown).toContain('Traced through the barrel `kit/index.js` to `kit/debounce.js`');
    });

    it('check import budgets against the traced cost', async () => {
        changeSetting('trueImportCost.budgets', { app: { import: '3 kB' } });
        await settle();

        expect(diagnosticsOf(document).map(diagnostic => [diagnostic.range.start.line, diagnostic.code])).toEqual([[2, 'import-budget']]);
    });

    it('read the barrel and the module that defines the name once, and no other source', async () => {
        await inlineCosts(document);

        expect(sourcesRead()).toEqual(BARREL_FILES);

        await inlineCosts(document);
        await hoverAt(document, 'debounce,');

        expect(sourcesRead()).toEqual([]);
    });
});

describe('import costs traced through a barrel that changes', () => {
    it('keep the analysis of the barrel until the build metadata reloads', async () => {
        vi.useFakeTimers();
        const document = writeKit();
        await activated();
        setVirtualFile('/w/node_modules/kit/index.js', lines(
            'export function debounce(callback) { return callback; }',
            "export { throttle } from './throttle.js';",
            "export * from './strings.js';",
        ));

        expect(await costOf(document, KIT_IMPORT)).toBe('2 kB bundled');

        flushFileReads();
        writeJson(METADATA, kitMetafile());
        fireFileWatcher('changed', METADATA);
        await vi.advanceTimersByTimeAsync(250);

        expect(await costOf(document, KIT_IMPORT)).toBe('5.5 kB bundled · 2.5 kB exclusive');
        expect(sourcesRead()).toEqual(['/w/node_modules/kit/index.js']);
    });
});

describe('import costs of barrels that cannot be traced', () => {
    it('keep the module-level cost of a barrel larger than the size limit, without reading it', async () => {
        const document = writeKit();
        setVirtualFile('/w/node_modules/kit/index.js', `${BARREL}${' '.repeat(2_000_001)}`);
        await activated();

        expect(await costOf(document, KIT_IMPORT)).toBe('5.5 kB bundled · 2.5 kB exclusive');
        expect(sourcesRead()).toEqual([]);
    });

    it('keep the module-level cost of a CommonJS barrel', async () => {
        const document = writeKit();
        setVirtualFile('/w/node_modules/kit/index.js', "module.exports = { ...require('./debounce.js'), ...require('./throttle.js') };\n");
        await activated();

        expect(await costOf(document, KIT_IMPORT)).toBe('5.5 kB bundled · 2.5 kB exclusive');
    });

    it('read no file that cannot be an ES module, such as a Vue component', async () => {
        writeJson(METADATA, esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 300, imports: [staticImport('./Widget.vue', 'src/Widget.vue')] },
                'src/Widget.vue': { output: 1_000, imports: [staticImport('./a.ts', 'src/a.ts'), staticImport('./b.ts', 'src/b.ts')] },
                'src/a.ts': { output: 100 },
                'src/b.ts': { output: 200 },
            },
        }));
        setVirtualFile('/w/src/Widget.vue', "<script>export { a } from './a';</script>\n");
        const statement = "import Widget from './Widget.vue';";
        const document = writeSource('/w/src/main.ts', lines(statement, 'console.log(Widget);'));
        await activated();

        expect(await costOf(document, statement)).toBe('1.3 kB bundled');
        expect(flushFileReads()).not.toContain('/w/src/Widget.vue');
    });

    it('read nothing for a namespace import', async () => {
        const statement = "import * as kit from 'kit';";
        const document = writeKit(lines(statement, "import './settings';", 'kit.debounce(() => 1);'));
        await activated();

        expect(await costOf(document, statement)).toBe('5.5 kB bundled · 2.5 kB exclusive');
        expect(sourcesRead()).toEqual([]);
    });
});

describe('the hover of an import traced to many modules', () => {
    it('names the first three and counts the rest', async () => {
        const icons = ['arrow', 'bell', 'clock', 'dot', 'eye'];
        writeJson(METADATA, esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 300, imports: [staticImport('icons', 'node_modules/icons/index.js')] },
                'node_modules/icons/index.js': { output: 0, imports: icons.map(icon => staticImport(`./${icon}.js`, `node_modules/icons/${icon}.js`)) },
                ...Object.fromEntries(icons.map(icon => [`node_modules/icons/${icon}.js`, { output: 1_000 }])),
            },
        }));
        setVirtualFile('/w/node_modules/icons/index.js', lines(...icons.map(icon => `export { ${icon} } from './${icon}.js';`)));
        for (const icon of icons) {
            setVirtualFile(`/w/node_modules/icons/${icon}.js`, `export const ${icon} = '${icon}';\n`);
        }
        const document = writeSource('/w/src/main.ts', lines(`import { ${icons.join(', ')} } from 'icons';`, `console.log(${icons.join(', ')});`));
        await activated();

        expect(markdownOf(await hoverAt(document, 'arrow')).value)
            .toContain('Traced through the barrel `icons/index.js` to `icons/arrow.js`, `icons/bell.js`, `icons/clock.js` and 2 more');
    });
});

describe('import costs traced through a barrel in several build targets', () => {
    it('trace the import in the other targets the hover lists', async () => {
        const document = writeKit();
        writeJson('/w/.true-import-cost/web.json', kitMetafile(4_000));
        await activated();

        expect(markdownOf(await hoverAt(document, 'debounce,')).value).toContain('Other targets: `web` 4 kB bundled');
    });
});
