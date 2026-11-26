import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { jsonSchemaErrors } from '../core/support/jsonSchema';

import type { BuildSnapshot, SnapshotParseResult } from '../../plugins/snapshot';

interface SpindleHooks {
    readonly loads: { readonly filter: RegExp; readonly load: (file: string) => Promise<string | undefined> }[];
    readonly ends: ((result: unknown) => Promise<void>)[];
    readonly warnings: string[];
}

interface SpindleBuildDouble {
    readonly version: string;
    readonly options: { readonly root: string; readonly minify: boolean; write: boolean };
    onLoad(filter: RegExp, load: (file: string) => Promise<string | undefined>): void;
    onEnd(callback: (result: unknown) => Promise<void>): void;
    warn(message: string): void;
}

interface GuidePlugin {
    trueImportCost(options?: { readonly target?: string }): { readonly name: string; setup(build: SpindleBuildDouble): void };
}

const ROOT = process.cwd();
const MEASURE_ENV = 'TRUE_IMPORT_COST_MEASURE';
const STATEMENT = "import { format } from 'ms';";
const directories: string[] = [];

let project: string;
let plugin: GuidePlugin;
let parseSnapshot: (value: unknown) => SnapshotParseResult;

function codeBlock(file: string, info: string): string {
    const markdown = readFileSync(path.join(ROOT, file), 'utf8');
    const block = new RegExp(`\`\`\`${info.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)\\n\`\`\``).exec(markdown)?.[1];
    if (block === undefined) {
        throw new Error(`${file} has no \`\`\`${info} block`);
    }
    return block;
}

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-guide-'));
    directories.push(directory);
    return directory;
}

function write(file: string, text: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
}

function typeErrors(files: readonly string[]): string[] {
    const program = ts.createProgram(files, {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
        strict: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
        typeRoots: [path.join(ROOT, 'node_modules/@types')],
    });
    return ts.getPreEmitDiagnostics(program).map(diagnostic => `${diagnostic.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
}

function spindleApp(): string {
    const root = path.join(temporaryDirectory(), 'app');
    write(path.join(root, 'src/main.ts'), `${STATEMENT}\nformat(1);\nvoid import('./lazy');\n`);
    write(path.join(root, 'node_modules/ms/package.json'), JSON.stringify({ name: 'ms', version: '2.1.3' }));
    return root;
}

function spindleBuild(root: string): { readonly build: SpindleBuildDouble; readonly hooks: SpindleHooks } {
    const hooks: SpindleHooks = { loads: [], ends: [], warnings: [] };
    const build: SpindleBuildDouble = {
        version: '2.4.0',
        options: { root, minify: true, write: true },
        onLoad: (filter, load) => hooks.loads.push({ filter, load }),
        onEnd: callback => hooks.ends.push(callback),
        warn: message => hooks.warnings.push(message),
    };
    return { build, hooks };
}

function spindleResult(root: string): unknown {
    const at = (file: string): string => path.join(root, file);
    const output = (fileName: string, size: number, modules: Readonly<Record<string, number>>, extra: object = {}): object =>
        ({ fileName, size, isDynamicEntry: false, imports: [], dynamicImports: [], modules, externals: [], ...extra });
    return {
        errors: [],
        modules: [
            {
                file: at('src/main.ts'),
                size: 120,
                imports: [
                    { specifier: 'ms', kind: 'import', resolved: at('node_modules/ms/index.js') },
                    { specifier: './lazy', kind: 'dynamic-import', resolved: at('src/lazy.ts') },
                    { specifier: './style.css', kind: 'css-import', resolved: at('src/style.css') },
                    { specifier: 'vscode', kind: 'import' },
                    { specifier: 'left-pad', kind: 'require' },
                ],
            },
            { file: at('src/lazy.ts'), size: 80, imports: [] },
            { file: at('src/style.css'), size: 300, imports: [{ specifier: './logo.png', kind: 'url', resolved: at('src/logo.png') }] },
            { file: at('src/logo.png'), size: 2048, imports: [] },
            { file: at('node_modules/ms/index.js'), size: 3000, imports: [] },
        ],
        outputs: [
            output('main.js', 1000, { [at('src/main.ts')]: 400, [at('node_modules/ms/index.js')]: 1600 }, {
                entry: at('src/main.ts'),
                imports: ['main.css'],
                dynamicImports: ['lazy.js'],
                externals: ['vscode'],
            }),
            output('lazy.js', 60, { [at('src/lazy.ts')]: 50 }, { entry: at('src/lazy.ts'), isDynamicEntry: true }),
            output('main.css', 250, { [at('src/style.css')]: 300 }, { imports: ['logo.png'] }),
            output('logo.png', 2048, { [at('src/logo.png')]: 2048 }),
        ],
    };
}

function readSnapshot(file: string): BuildSnapshot {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    expect(jsonSchemaErrors(value)).toEqual([]);
    const result = parseSnapshot(value);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.snapshot;
}

beforeAll(async () => {
    project = temporaryDirectory();
    write(path.join(project, 'package.json'), JSON.stringify({ type: 'module' }));
    write(path.join(project, 'node_modules/spindle/package.json'), JSON.stringify({ name: 'spindle', types: 'index.d.ts' }));
    write(path.join(project, 'node_modules/spindle/index.d.ts'), codeBlock('docs/writing-a-plugin.md', 'ts spindle.d.ts'));
    mkdirSync(path.join(project, 'node_modules/@true-import-cost'), { recursive: true });
    symlinkSync(path.join(ROOT, 'packages/snapshot'), path.join(project, 'node_modules/@true-import-cost/snapshot'), 'junction');

    const source = codeBlock('docs/writing-a-plugin.md', 'ts true-import-cost-spindle.ts');
    write(path.join(project, 'plugin.ts'), source);
    write(path.join(project, 'plugin.mjs'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
    plugin = await import(pathToFileURL(path.join(project, 'plugin.mjs')).href) as GuidePlugin;
    ({ parseSnapshot } = await import(pathToFileURL(path.join(ROOT, 'packages/snapshot/dist/index.mjs')).href) as { parseSnapshot: typeof parseSnapshot });
}, 60_000);

afterEach(() => {
    delete process.env[MEASURE_ENV];
});

afterAll(() => {
    for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('the examples that use @true-import-cost/snapshot', () => {
    it('compile against the declarations the package publishes', () => {
        write(path.join(project, 'readme.ts'), codeBlock('packages/snapshot/README.md', 'ts'));

        expect(typeErrors([path.join(project, 'plugin.ts'), path.join(project, 'readme.ts')])).toEqual([]);
    });
});

describe('the example plugin of the guide', () => {
    it('writes a valid snapshot of a Spindle build, with honest precisions and package versions', async () => {
        const root = spindleApp();
        const { build, hooks } = spindleBuild(root);
        plugin.trueImportCost({ target: 'web app' }).setup(build);

        await Promise.all(hooks.ends.map(end => end(spindleResult(root))));

        const file = path.join(root, '.true-import-cost', 'web-app.json');
        const snapshot = readSnapshot(file);
        const contributions = Object.fromEntries(snapshot.modules.map(module => [module.id, module.contributions]));
        expect(hooks.warnings).toEqual([]);
        expect(build.options.write).toBe(true);
        expect(snapshot).toMatchObject({ target: 'web-app', bundler: { name: 'spindle', version: '2.4.0' }, mode: 'production' });
        expect(path.resolve(path.dirname(file), snapshot.root)).toBe(root);
        expect(snapshot.modules.find(module => module.id === 'node_modules/ms/index.js')).toMatchObject({ packageName: 'ms', packageVersion: '2.1.3' });
        expect(snapshot.chunks.map(chunk => [chunk.id, chunk.entry, chunk.dynamicEntry])).toEqual([['main.js', true, false], ['lazy.js', false, true], ['main.css', false, false]]);
        expect(contributions).toMatchObject({
            'src/main.ts': [{ chunkId: 'main.js', bytes: 200, precision: 'proportional-estimate' }],
            'src/lazy.ts': [{ chunkId: 'lazy.js', bytes: 50, precision: 'rendered-length' }],
            'src/logo.png': [{ chunkId: 'logo.png', bytes: 2048, precision: 'bundler-reported' }],
        });
        expect(snapshot.imports.filter(edge => edge.external)).toEqual([
            { importer: 'src/main.ts', specifier: 'vscode', kind: 'static', external: true, retained: true },
            { importer: 'src/main.ts', specifier: 'left-pad', kind: 'require', external: true, retained: false },
        ]);
    });

    it('writes nothing after a failed build', async () => {
        const root = spindleApp();
        const { build, hooks } = spindleBuild(root);
        plugin.trueImportCost().setup(build);

        await Promise.all(hooks.ends.map(end => end({ errors: ['src/main.ts: unexpected token'], modules: [], outputs: [] })));

        expect(existsSync(path.join(root, '.true-import-cost'))).toBe(false);
    });

    it('takes part in measuring an import: edits the source it loads, writes no output, and reports to the request\'s folder', async () => {
        const root = spindleApp();
        const outDir = path.join(temporaryDirectory(), 'without');
        const requestFile = path.join(path.dirname(outDir), 'request.json');
        const main = path.join(root, 'src/main.ts');
        write(requestFile, JSON.stringify({ version: 1, outDir, edits: [{ file: main, start: 0, end: STATEMENT.length, expected: STATEMENT, replacement: 'const format = void 0;' }] }));
        process.env[MEASURE_ENV] = requestFile;
        const { build, hooks } = spindleBuild(root);
        plugin.trueImportCost({ target: 'web' }).setup(build);

        const loaded = await hooks.loads[0]?.load(main);
        await Promise.all(hooks.ends.map(end => end(spindleResult(root))));

        expect(build.options.write).toBe(false);
        expect(hooks.loads.map(hook => hook.filter.test(main))).toEqual([true]);
        expect(loaded).toBe('const format = void 0;\nformat(1);\nvoid import(\'./lazy\');\n');
        expect(readSnapshot(path.join(outDir, 'web.json')).target).toBe('web');
        expect(JSON.parse(readFileSync(path.join(outDir, 'web.edits.json'), 'utf8'))).toEqual({ version: 1, target: 'web', applied: [main], missing: [] });
        expect(existsSync(path.join(root, '.true-import-cost'))).toBe(false);
    });
});
