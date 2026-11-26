import { describe, expect, it } from 'vitest';

import {
    BUILD_CONTEXT,
    dynamicImport,
    externalImport,
    importOf,
    input,
    metafile,
    output,
    statement,
} from './support/esbuild';
import { bytesIn, chunkIn, edgesFrom, moduleIn } from './support/snapshot';
import { MetadataError } from '../../core/adapters/adapter';
import { esbuildAdapter, isEsbuildMetafile, normalizeEsbuildMetafile } from '../../core/adapters/esbuild';
import { normalizeMetadata } from '../../core/adapters/registry';
import { parseSnapshot } from '../../core/schema/validate';

import type { EsbuildImportKind } from './support/esbuild';
import type { ImportKind } from '../../core/schema/snapshot';

const EXTENSION_HOST = metafile(
    {
        'src/extension.ts': input(900, [
            statement('src/commands.ts', './commands'),
            statement('src/unused.ts', './unused'),
            externalImport('vscode'),
            externalImport('typescript'),
            dynamicImport('src/heavy.ts', './heavy'),
        ]),
        'src/commands.ts': input(400, [statement('node_modules/lodash-es/debounce.js', 'lodash-es/debounce')]),
        'src/unused.ts': input(200),
        'src/heavy.ts': input(300),
        'node_modules/lodash-es/debounce.js': input(1200),
    },
    {
        'dist/extension.js': output(
            { 'src/extension.ts': 500, 'src/commands.ts': 250, 'node_modules/lodash-es/debounce.js': 600, 'src/unused.ts': 0 },
            {
                bytes: 1400,
                entryPoint: 'src/extension.ts',
                imports: [externalImport('vscode', 'require-call'), importOf('dist/heavy-5HJK.js', 'dynamic-import')],
            },
        ),
        'dist/heavy-5HJK.js': output({ 'src/heavy.ts': 150 }, { bytes: 180, entryPoint: 'src/heavy.ts' }),
        'dist/extension.js.map': output({}, { bytes: 5000 }),
    },
);

const FILE_LOADER = metafile(
    { 'src/main.ts': input(100, [statement('src/logo.png', './logo.png')]), 'src/logo.png': input(2048) },
    {
        'dist/main.js': output({ 'src/main.ts': 90, 'src/logo.png': 30 }, {
            entryPoint: 'src/main.ts',
            imports: [importOf('dist/logo-K2.png', 'file-loader')],
        }),
        'dist/logo-K2.png': output({ 'src/logo.png': 2048 }),
    },
);

describe('normalizeEsbuildMetafile', () => {
    const snapshot = normalizeEsbuildMetafile(EXTENSION_HOST, BUILD_CONTEXT);

    it('turns every input into a module with its source size', () => {
        expect(snapshot.modules.map(module => [module.id, module.sourceBytes])).toEqual([
            ['src/extension.ts', 900],
            ['src/commands.ts', 400],
            ['src/unused.ts', 200],
            ['src/heavy.ts', 300],
            ['node_modules/lodash-es/debounce.js', 1200],
        ]);
    });

    it('records the bytes each input left in each output as bundler-reported', () => {
        expect(moduleIn(snapshot, 'src/commands.ts').contributions).toEqual([{ chunkId: 'dist/extension.js', bytes: 250, precision: 'bundler-reported' }]);
        expect(bytesIn(snapshot, 'src/heavy.ts')).toEqual({ 'dist/heavy-5HJK.js': 150 });
    });

    it('records no contribution for an input that left no bytes in the output', () => {
        expect(moduleIn(snapshot, 'src/unused.ts').contributions).toEqual([]);
    });

    it('derives the package of modules inside node_modules', () => {
        expect(moduleIn(snapshot, 'node_modules/lodash-es/debounce.js')).toMatchObject({ packageName: 'lodash-es', packageRoot: 'node_modules/lodash-es' });
        expect(moduleIn(snapshot, 'src/commands.ts').packageName).toBeUndefined();
    });

    it('keeps the original specifier of resolved imports', () => {
        expect(edgesFrom(snapshot, 'src/extension.ts').filter(edge => !edge.external)).toEqual([
            { importer: 'src/extension.ts', specifier: './commands', resolvedModule: 'src/commands.ts', kind: 'static', external: false },
            { importer: 'src/extension.ts', specifier: './unused', resolvedModule: 'src/unused.ts', kind: 'static', external: false },
            { importer: 'src/extension.ts', specifier: './heavy', resolvedModule: 'src/heavy.ts', kind: 'dynamic', external: false },
        ]);
    });

    it('marks an external import the output still contains as retained', () => {
        expect(edgesFrom(snapshot, 'src/extension.ts').find(edge => edge.specifier === 'vscode'))
            .toEqual({ importer: 'src/extension.ts', specifier: 'vscode', kind: 'static', external: true, retained: true });
    });

    it('marks an external import the output no longer contains as not retained', () => {
        expect(edgesFrom(snapshot, 'src/extension.ts').find(edge => edge.specifier === 'typescript'))
            .toEqual({ importer: 'src/extension.ts', specifier: 'typescript', kind: 'static', external: true, retained: false });
    });

    it('treats an entry point nothing imports as an entry, and a dynamic-import chunk as a dynamic entry', () => {
        expect(moduleIn(snapshot, 'src/extension.ts').entry).toBe(true);
        expect(moduleIn(snapshot, 'src/heavy.ts').entry).toBeUndefined();
        expect(chunkIn(snapshot, 'dist/extension.js')).toMatchObject({ entry: true, dynamicEntry: false, entryModule: 'src/extension.ts' });
        expect(chunkIn(snapshot, 'dist/heavy-5HJK.js')).toMatchObject({ entry: false, dynamicEntry: true, entryModule: 'src/heavy.ts' });
    });

    it('lists the dynamic imports of a chunk but not its external imports', () => {
        expect(chunkIn(snapshot, 'dist/extension.js')).toMatchObject({ bytes: 1400, kind: 'js', imports: [], dynamicImports: ['dist/heavy-5HJK.js'] });
    });

    it('turns outputs that are neither JavaScript nor CSS into assets', () => {
        expect(snapshot.chunks.map(chunk => chunk.id)).toEqual(['dist/extension.js', 'dist/heavy-5HJK.js']);
        expect(snapshot.assets).toEqual([{ id: 'dist/extension.js.map', kind: 'sourcemap', bytes: 5000 }]);
    });

    it('takes the target and creation time from the context and names the bundler', () => {
        expect(snapshot).toMatchObject({
            format: 'true-import-cost/build-snapshot',
            schemaVersion: 1,
            id: 'app@1700000000000',
            target: 'app',
            createdAt: 1_700_000_000_000,
            bundler: { name: 'esbuild' },
            root: '.',
        });
        expect(snapshot).not.toHaveProperty('mode');
    });

    it('produces a snapshot that passes validation', () => {
        expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual({ ok: true, snapshot });
    });
});

describe('normalizeEsbuildMetafile import kinds', () => {
    it.each<[EsbuildImportKind, ImportKind]>([
        ['import-statement', 'static'],
        ['require-call', 'require'],
        ['dynamic-import', 'dynamic'],
        ['import-rule', 'css'],
        ['composes-from', 'css'],
        ['require-resolve', 'reference'],
        ['url-token', 'reference'],
    ])('maps %s onto %s', (esbuildKind, kind) => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { 'src/a.ts': input(10, [importOf('src/b.ts', esbuildKind)]), 'src/b.ts': input(10) },
            { 'out.js': output({ 'src/a.ts': 10, 'src/b.ts': 10 }, { entryPoint: 'src/a.ts' }) },
        ), BUILD_CONTEXT);

        expect(edgesFrom(snapshot, 'src/a.ts').map(edge => edge.kind)).toEqual([kind]);
    });

    it('skips import records of kinds it does not know', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { 'src/a.ts': input(10, [importOf('src/b.ts', 'entry-point'), { path: 'src/b.ts', kind: 'import-attribute' }]), 'src/b.ts': input(10) },
            { 'out.js': output({ 'src/a.ts': 10 }) },
        ), BUILD_CONTEXT);

        expect(snapshot.imports).toEqual([]);
    });
});

describe('normalizeEsbuildMetafile edge cases', () => {
    it('uses the original specifier of an external import when esbuild records one', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { 'src/a.ts': input(10, [{ path: 'node:fs', kind: 'import-statement', external: true, original: 'fs' }]) },
            { 'out.js': output({ 'src/a.ts': 10 }, { imports: [externalImport('node:fs', 'require-call')] }) },
        ), BUILD_CONTEXT);

        expect(snapshot.imports).toEqual([{ importer: 'src/a.ts', specifier: 'fs', kind: 'static', external: true, retained: true }]);
    });

    it('drops duplicate import records', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { 'src/a.ts': input(10, [statement('src/b.ts', './b'), statement('src/b.ts', './b'), externalImport('vscode'), externalImport('vscode')]), 'src/b.ts': input(5) },
            { 'out.js': output({ 'src/a.ts': 10, 'src/b.ts': 5 }) },
        ), BUILD_CONTEXT);

        expect(snapshot.imports).toHaveLength(2);
    });

    it('marks every entry point without importers as an entry', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            {
                'src/web.ts': input(10, [statement('src/shared.ts', './shared')]),
                'src/worker.ts': input(10, [statement('src/shared.ts', './shared')]),
                'src/shared.ts': input(10),
            },
            {
                'dist/web.js': output({ 'src/web.ts': 10, 'src/shared.ts': 10 }, { entryPoint: 'src/web.ts' }),
                'dist/worker.js': output({ 'src/worker.ts': 10, 'src/shared.ts': 10 }, { entryPoint: 'src/worker.ts' }),
            },
        ), BUILD_CONTEXT);

        expect(snapshot.modules.filter(module => module.entry === true).map(module => module.id)).toEqual(['src/web.ts', 'src/worker.ts']);
        expect(snapshot.chunks.map(chunk => chunk.entry)).toEqual([true, true]);
    });

    it('keeps an entry point that another entry point imports statically as an entry', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            {
                'src/index.ts': input(100, [statement('src/utils.ts', './utils'), dynamicImport('src/lazy.ts', './lazy')]),
                'src/utils.ts': input(50),
                'src/lazy.ts': input(30),
            },
            {
                'dist/index.js': output({ 'src/index.ts': 80 }, { entryPoint: 'src/index.ts', imports: [importOf('dist/lazy.js', 'dynamic-import')] }),
                'dist/utils.js': output({ 'src/utils.ts': 40 }, { entryPoint: 'src/utils.ts' }),
                'dist/lazy.js': output({ 'src/lazy.ts': 25 }, { entryPoint: 'src/lazy.ts' }),
            },
        ), BUILD_CONTEXT);

        expect(snapshot.modules.filter(module => module.entry === true).map(module => module.id)).toEqual(['src/index.ts', 'src/utils.ts']);
        expect(chunkIn(snapshot, 'dist/utils.js')).toMatchObject({ entry: true, dynamicEntry: false });
        expect(chunkIn(snapshot, 'dist/lazy.js')).toMatchObject({ entry: false, dynamicEntry: true });
    });

    it('marks every entry point as an entry when each of them is imported by another', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            {
                'src/a.ts': input(10, [statement('src/b.ts', './b')]),
                'src/b.ts': input(10, [statement('src/a.ts', './a')]),
            },
            {
                'dist/a.js': output({ 'src/a.ts': 10, 'src/b.ts': 10 }, { entryPoint: 'src/a.ts' }),
                'dist/b.js': output({ 'src/a.ts': 10, 'src/b.ts': 10 }, { entryPoint: 'src/b.ts' }),
            },
        ), BUILD_CONTEXT);

        expect(snapshot.modules.map(module => module.entry)).toEqual([true, true]);
    });

    it('lists the shared chunks a chunk imports, but not externals or files that are not outputs', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { 'src/main.ts': input(100, [statement('src/shared.ts', './shared')]), 'src/shared.ts': input(40) },
            {
                'dist/main.js': output({ 'src/main.ts': 90 }, {
                    entryPoint: 'src/main.ts',
                    imports: [
                        importOf('dist/chunk-SHARED.js', 'import-statement'),
                        importOf('dist/missing.js', 'import-statement'),
                        externalImport('vscode', 'require-call'),
                    ],
                }),
                'dist/chunk-SHARED.js': output({ 'src/shared.ts': 40 }),
            },
        ), BUILD_CONTEXT);

        expect(chunkIn(snapshot, 'dist/main.js')).toMatchObject({ imports: ['dist/chunk-SHARED.js'], dynamicImports: [] });
        expect(chunkIn(snapshot, 'dist/chunk-SHARED.js')).toMatchObject({ entry: false, dynamicEntry: false });
    });

    it('records CSS outputs as CSS chunks and links the CSS bundle of a JS output', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            {
                'src/main.ts': input(100, [statement('src/style.css', './style.css')]),
                'src/style.css': input(80, [importOf('src/font.woff2', 'url-token')]),
                'src/font.woff2': input(4096),
            },
            {
                'dist/main.js': output({ 'src/main.ts': 90 }, { entryPoint: 'src/main.ts', cssBundle: 'dist/main.css' }),
                'dist/main.css': output({ 'src/style.css': 70 }, { entryPoint: 'src/main.ts' }),
                'dist/font-Q1.woff2': output({ 'src/font.woff2': 4096 }),
            },
        ), BUILD_CONTEXT);

        expect(chunkIn(snapshot, 'dist/main.js').css).toEqual(['dist/main.css']);
        expect(chunkIn(snapshot, 'dist/main.css')).toMatchObject({ kind: 'css', bytes: 70, entry: true, entryModule: 'src/main.ts' });
        expect(snapshot.assets).toEqual([{ id: 'dist/font-Q1.woff2', kind: 'font', bytes: 4096 }]);
        expect(edgesFrom(snapshot, 'src/style.css')).toEqual([
            { importer: 'src/style.css', resolvedModule: 'src/font.woff2', kind: 'reference', external: false },
        ]);
        expect(parseSnapshot(snapshot).ok).toBe(true);
    });

    it('turns a file-loader output into an asset that the imported file contributes to', () => {
        const snapshot = normalizeEsbuildMetafile(FILE_LOADER, BUILD_CONTEXT);

        expect(snapshot.assets).toEqual([{ id: 'dist/logo-K2.png', kind: 'image', bytes: 2048 }]);
        expect(bytesIn(snapshot, 'src/logo.png')).toEqual({ 'dist/main.js': 30, 'dist/logo-K2.png': 2048 });
        expect(parseSnapshot(snapshot).ok).toBe(true);
    });

    it('lists a file-loader output among the assets of the chunk, not among its chunk imports', () => {
        const snapshot = normalizeEsbuildMetafile(FILE_LOADER, BUILD_CONTEXT);

        expect(chunkIn(snapshot, 'dist/main.js')).toMatchObject({ imports: [], assets: ['dist/logo-K2.png'] });
    });

    it('omits a CSS bundle that is not among the outputs', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { 'src/main.ts': input(10) },
            { 'dist/main.js': output({ 'src/main.ts': 10 }, { cssBundle: 'dist/gone.css' }) },
        ), BUILD_CONTEXT);

        expect(chunkIn(snapshot, 'dist/main.js').css).toEqual([]);
    });

    it('keeps virtual and namespaced inputs verbatim and flags them as virtual', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { '<stdin>': input(20, [statement('env-ns:config', 'virtual-config')]), 'env-ns:config': input(30) },
            { 'out.js': output({ '<stdin>': 20, 'env-ns:config': 30 }, { entryPoint: '<stdin>' }) },
        ), BUILD_CONTEXT);

        expect(snapshot.modules).toEqual([
            { id: '<stdin>', path: '<stdin>', virtual: true, entry: true, sourceBytes: 20, contributions: [{ chunkId: 'out.js', bytes: 20, precision: 'bundler-reported' }] },
            { id: 'env-ns:config', path: 'env-ns:config', virtual: true, sourceBytes: 30, contributions: [{ chunkId: 'out.js', bytes: 30, precision: 'bundler-reported' }] },
        ]);
    });

    it('normalises Windows paths without taking the drive letter for a namespace', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { 'C:\\work\\app\\src\\main.ts': input(20, [statement('C:\\work\\app\\src\\util.ts', './util')]), 'C:\\work\\app\\src\\util.ts': input(10) },
            { 'C:\\work\\app\\dist\\main.js': output({ 'C:\\work\\app\\src\\main.ts': 20, 'C:\\work\\app\\src\\util.ts': 10 }, { entryPoint: 'C:\\work\\app\\src\\main.ts' }) },
        ), BUILD_CONTEXT);

        expect(snapshot.modules.map(module => [module.id, module.virtual])).toEqual([['C:/work/app/src/main.ts', undefined], ['C:/work/app/src/util.ts', undefined]]);
        expect(snapshot.imports[0]).toMatchObject({ importer: 'C:/work/app/src/main.ts', resolvedModule: 'C:/work/app/src/util.ts' });
        expect(snapshot.chunks[0]).toMatchObject({ id: 'C:/work/app/dist/main.js', entry: true, entryModule: 'C:/work/app/src/main.ts' });
    });

    it('strips a query from the module path but keeps it in the id', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { 'src/main.ts': input(10, [statement('src/shader.glsl?raw', './shader.glsl?raw')]), 'src/shader.glsl?raw': input(50) },
            { 'out.js': output({ 'src/main.ts': 10, 'src/shader.glsl?raw': 60 }) },
        ), BUILD_CONTEXT);

        expect(moduleIn(snapshot, 'src/shader.glsl?raw')).toMatchObject({ path: 'src/shader.glsl', sourceBytes: 50 });
    });

    it('creates a module for an import target that has no input of its own', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { 'src/a.ts': input(10, [statement('src/./b.ts', './b')]) },
            { 'out.js': output({ 'src/a.ts': 10 }) },
        ), BUILD_CONTEXT);

        expect(moduleIn(snapshot, 'src/b.ts')).toEqual({ id: 'src/b.ts', path: 'src/b.ts', contributions: [] });
        expect(parseSnapshot(snapshot).ok).toBe(true);
    });

    it('reads the version of a package installed by pnpm from its path', () => {
        const snapshot = normalizeEsbuildMetafile(metafile(
            { 'node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js': input(10) },
            { 'out.js': output({ 'node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js': 10 }) },
        ), BUILD_CONTEXT);

        expect(snapshot.modules[0]).toMatchObject({
            packageName: 'ms',
            packageVersion: '2.1.3',
            packageRoot: 'node_modules/.pnpm/ms@2.1.3/node_modules/ms',
        });
    });

    it('accepts inputs without an import list and outputs without an input map', () => {
        const snapshot = normalizeEsbuildMetafile({ inputs: { 'src/a.ts': { bytes: 10 } }, outputs: { 'out.js': { bytes: 10 } } }, BUILD_CONTEXT);

        expect(snapshot.modules).toEqual([{ id: 'src/a.ts', path: 'src/a.ts', sourceBytes: 10, contributions: [] }]);
        expect(snapshot.chunks).toHaveLength(1);
    });

    it('passes the whole build context through', () => {
        const snapshot = normalizeEsbuildMetafile(metafile({}, {}), {
            target: 'webview',
            createdAt: 42,
            id: 'f00dfeed',
            root: '..',
            mode: 'production',
            bundler: { name: 'esbuild', version: '0.28.2' },
        });

        expect(snapshot).toMatchObject({
            id: 'f00dfeed',
            target: 'webview',
            createdAt: 42,
            root: '..',
            mode: 'production',
            bundler: { name: 'esbuild', version: '0.28.2' },
        });
    });
});

describe('normalizeEsbuildMetafile on malformed metadata', () => {
    it.each<[string, unknown, string]>([
        ['null', null, 'the metadata is not an esbuild metafile'],
        ['a list', [], 'the metadata is not an esbuild metafile'],
        ['a metafile without outputs', { inputs: {} }, 'the metadata is not an esbuild metafile'],
        ['a metafile whose inputs are a list', { inputs: [], outputs: {} }, 'the metadata is not an esbuild metafile'],
        ['an input that is not an object', { inputs: { 'a.ts': 5 }, outputs: {} }, 'input "a.ts" is not an object'],
        ['a negative input size', { inputs: { 'a.ts': { bytes: -1, imports: [] } }, outputs: {} }, 'input "a.ts" is not a byte count'],
        ['an input size given as a string', { inputs: { 'a.ts': { bytes: '10', imports: [] } }, outputs: {} }, 'input "a.ts" is not a byte count'],
        ['an import list that is not a list', { inputs: { 'a.ts': { bytes: 1, imports: {} } }, outputs: {} }, 'input "a.ts".imports is not a list'],
        ['an import record without a kind', { inputs: { 'a.ts': { bytes: 1, imports: [{ path: 'b.ts' }] } }, outputs: {} }, 'input "a.ts".imports[0] is not an import record'],
        ['an output that is not an object', { inputs: {}, outputs: { 'out.js': true } }, 'output "out.js" is not an object'],
        ['an output without a size', { inputs: {}, outputs: { 'out.js': { inputs: {}, imports: [] } } }, 'output "out.js" is not a byte count'],
        ['an output input map that is a list', { inputs: {}, outputs: { 'out.js': { bytes: 1, inputs: [], imports: [] } } }, 'output "out.js" has no input map'],
        ['an output input that is not an object', { inputs: {}, outputs: { 'out.js': { bytes: 1, inputs: { 'a.ts': 3 }, imports: [] } } }, 'output "out.js" input "a.ts" is not an object'],
        ['a missing bytesInOutput', { inputs: {}, outputs: { 'out.js': { bytes: 1, inputs: { 'a.ts': {} }, imports: [] } } }, 'output "out.js" input "a.ts" is not a byte count'],
        ['an output import record that is not an object', { inputs: {}, outputs: { 'out.js': { bytes: 1, inputs: {}, imports: ['vscode'] } } }, 'output "out.js".imports[0] is not an import record'],
    ])('rejects %s with a metadata error', (_, value, message) => {
        expect(() => normalizeEsbuildMetafile(value, BUILD_CONTEXT)).toThrow(new MetadataError(message));
    });

    it('treats a "__proto__" input from JSON as an ordinary module without polluting Object.prototype', async () => {
        const text = '{"inputs":{"__proto__":{"bytes":12,"imports":[]}},"outputs":{"out.js":{"bytes":12,"inputs":{"__proto__":{"bytesInOutput":12}},"imports":[]}}}';

        const result = await normalizeMetadata(JSON.parse(text), BUILD_CONTEXT);

        expect(result.ok && result.snapshot.modules).toEqual([
            { id: '__proto__', path: '__proto__', sourceBytes: 12, contributions: [{ chunkId: 'out.js', bytes: 12, precision: 'bundler-reported' }] },
        ]);
        expect(({} as Record<string, unknown>).bytes).toBeUndefined();
        expect(({} as Record<string, unknown>).bytesInOutput).toBeUndefined();
    });

    it('rejects a malformed "__proto__" input from JSON with a metadata error', async () => {
        const text = '{"inputs":{"__proto__":{"bytes":"a lot","imports":[]}},"outputs":{}}';

        expect(await normalizeMetadata(JSON.parse(text), BUILD_CONTEXT)).toEqual({ ok: false, error: 'input "__proto__" is not a byte count' });
        expect(({} as Record<string, unknown>).imports).toBeUndefined();
    });

    it('does not read inputs and outputs inherited through a "__proto__" key', async () => {
        const text = '{"__proto__":{"inputs":{},"outputs":{}}}';

        expect(await normalizeMetadata(JSON.parse(text), BUILD_CONTEXT)).toEqual({
            ok: false,
            error: 'the file is neither a True Import Cost snapshot nor build metadata of a supported bundler',
        });
    });
});

describe('isEsbuildMetafile', () => {
    it('recognises an object with input and output maps and no format marker', () => {
        expect(isEsbuildMetafile(EXTENSION_HOST)).toBe(true);
        expect(isEsbuildMetafile({ inputs: {}, outputs: {} })).toBe(true);
        expect(isEsbuildMetafile({ format: 'true-import-cost/build-snapshot', inputs: {}, outputs: {} })).toBe(false);
        expect(isEsbuildMetafile({ inputs: {}, outputs: [] })).toBe(false);
        expect(isEsbuildMetafile(undefined)).toBe(false);
    });
});

describe('esbuildAdapter', () => {
    it('normalises asynchronously under the name "esbuild"', async () => {
        expect(esbuildAdapter.name).toBe('esbuild');
        await expect(esbuildAdapter.normalize(EXTENSION_HOST, BUILD_CONTEXT)).resolves.toEqual(normalizeEsbuildMetafile(EXTENSION_HOST, BUILD_CONTEXT));
    });
});
