import { describe, expect, it } from 'vitest';

import { chunkRecord } from './support/snapshot';
import { SnapshotBuilder } from '../../core/adapters/snapshotBuilder';

const CONTEXT = { target: 'web', createdAt: 1234 };

describe('SnapshotBuilder modules', () => {
    it('keeps the first path of a module and later fills in its source size', () => {
        const builder = new SnapshotBuilder();
        builder.module('src/a.ts', 'src/a.ts', { virtual: false });
        builder.module('src/a.ts', 'elsewhere/a.ts', { virtual: true, sourceBytes: 300 });

        expect(builder.build(CONTEXT).modules).toEqual([{ id: 'src/a.ts', path: 'src/a.ts', sourceBytes: 300, contributions: [] }]);
    });

    it('derives the package of a module from its path, including a pnpm version', () => {
        const builder = new SnapshotBuilder();
        builder.module('ms', 'node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js');
        builder.module('react', 'node_modules/react/index.js');

        expect(builder.build(CONTEXT).modules).toEqual([
            {
                id: 'ms',
                path: 'node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js',
                packageName: 'ms',
                packageVersion: '2.1.3',
                packageRoot: 'node_modules/.pnpm/ms@2.1.3/node_modules/ms',
                contributions: [],
            },
            { id: 'react', path: 'node_modules/react/index.js', packageName: 'react', packageRoot: 'node_modules/react', contributions: [] },
        ]);
    });
});

describe('SnapshotBuilder contributions', () => {
    it('adds up contributions to the same chunk, rounds them and keeps the least precise measurement', () => {
        const builder = new SnapshotBuilder();
        builder.module('a', 'a.ts');
        builder.contribute('a', 'main.js', 10.4, 'bundler-reported');
        builder.contribute('a', 'main.js', 5.2, 'proportional-estimate');
        builder.contribute('a', 'main.js', 1, 'sourcemap-estimate');
        builder.contribute('a', 'other.js', 7, 'rendered-length');

        expect(builder.build(CONTEXT).modules[0]?.contributions).toEqual([
            { chunkId: 'main.js', bytes: 16, precision: 'proportional-estimate' },
            { chunkId: 'other.js', bytes: 7, precision: 'rendered-length' },
        ]);
    });

    it('ignores empty contributions and contributions of unknown modules', () => {
        const builder = new SnapshotBuilder();
        builder.module('a', 'a.ts');
        builder.contribute('a', 'main.js', 0, 'bundler-reported');
        builder.contribute('a', 'main.js', -3, 'bundler-reported');
        builder.contribute('missing', 'main.js', 10, 'bundler-reported');

        expect(builder.build(CONTEXT).modules).toEqual([{ id: 'a', path: 'a.ts', contributions: [] }]);
    });
});

describe('SnapshotBuilder edges', () => {
    it('drops an edge identical to one it already has', () => {
        const builder = new SnapshotBuilder();
        builder.edge({ importer: 'a', resolvedModule: 'b', specifier: './b', kind: 'static', external: false });
        builder.edge({ importer: 'a', resolvedModule: 'b', specifier: './b', kind: 'static', external: false });
        builder.edge({ importer: 'a', resolvedModule: 'b', specifier: './b', kind: 'dynamic', external: false });
        builder.edge({ importer: 'a', resolvedModule: 'b', specifier: './b.js', kind: 'static', external: false });
        builder.edge({ importer: 'a', specifier: 'b', kind: 'static', external: true });

        expect(builder.build(CONTEXT).imports).toHaveLength(4);
    });
});

describe('SnapshotBuilder entries', () => {
    it('marks the modules it has as entries and ignores unknown ones', () => {
        const builder = new SnapshotBuilder();
        builder.module('main', 'src/main.ts');
        builder.module('util', 'src/util.ts');
        builder.markEntry('main');
        builder.markEntry('missing');

        expect(builder.build(CONTEXT).modules.map(module => [module.id, module.entry])).toEqual([['main', true], ['util', undefined]]);
    });
});

describe('SnapshotBuilder outputs', () => {
    it('knows the chunks and assets it was given', () => {
        const builder = new SnapshotBuilder();
        builder.chunk(chunkRecord({ id: 'main.js', bytes: 10 }));
        builder.asset({ id: 'logo.png', kind: 'image', bytes: 20 });

        expect([builder.hasOutput('main.js'), builder.hasOutput('logo.png'), builder.hasOutput('main.css')]).toEqual([true, true, false]);
    });

    it('replaces a chunk registered twice under the same id', () => {
        const builder = new SnapshotBuilder();
        builder.chunk(chunkRecord({ id: 'main.js', bytes: 10 }));
        builder.chunk(chunkRecord({ id: 'main.js', bytes: 25 }));

        expect(builder.build(CONTEXT).chunks).toEqual([chunkRecord({ id: 'main.js', bytes: 25 })]);
    });

    it('fills in what a chunk leaves out: no entry, and nothing it loads', () => {
        const builder = new SnapshotBuilder();
        builder.chunk({ id: 'main.js', kind: 'js', bytes: 10 });
        builder.chunk({ id: 'lazy.js', kind: 'js', bytes: 5, dynamicEntry: true, entryModule: 'src/lazy.ts', css: ['lazy.css'] });

        expect(builder.build(CONTEXT).chunks).toEqual([
            chunkRecord({ id: 'main.js', bytes: 10 }),
            chunkRecord({ id: 'lazy.js', bytes: 5, dynamicEntry: true, entryModule: 'src/lazy.ts', css: ['lazy.css'] }),
        ]);
    });
});

describe('SnapshotBuilder.build', () => {
    it('fills in defaults for what the context leaves out', () => {
        expect(new SnapshotBuilder().build(CONTEXT)).toEqual({
            format: 'true-import-cost/build-snapshot',
            schemaVersion: 1,
            id: 'web@1234',
            target: 'web',
            createdAt: 1234,
            bundler: { name: 'unknown' },
            root: '.',
            modules: [],
            chunks: [],
            assets: [],
            imports: [],
        });
    });

    it('returns a snapshot that later changes to the builder leave alone', () => {
        const builder = new SnapshotBuilder();
        builder.module('a', 'a.ts');
        builder.module('b', 'b.ts');
        builder.edge({ importer: 'a', resolvedModule: 'b', kind: 'static', external: false });
        const first = builder.build(CONTEXT);

        builder.edge({ importer: 'b', resolvedModule: 'a', kind: 'static', external: false });
        builder.contribute('a', 'main.js', 10, 'bundler-reported');

        expect(first.imports).toHaveLength(1);
        expect(first.modules[0]?.contributions).toEqual([]);
        expect(builder.build(CONTEXT).imports).toHaveLength(2);
    });

    it('takes the id, root, bundler and mode from the context', () => {
        expect(new SnapshotBuilder().build({ ...CONTEXT, id: 'abc', root: '../..', bundler: { name: 'vite', version: '8.3.8' }, mode: 'development' }))
            .toMatchObject({ id: 'abc', root: '../..', bundler: { name: 'vite', version: '8.3.8' }, mode: 'development' });
    });

    it('writes only the optional module fields that are set', () => {
        const builder = new SnapshotBuilder();
        builder.module('virtual:env', 'virtual:env', { virtual: true });
        builder.module('main', 'src/main.ts');
        builder.markEntry('main');

        expect(builder.build(CONTEXT).modules).toEqual([
            { id: 'virtual:env', path: 'virtual:env', virtual: true, contributions: [] },
            { id: 'main', path: 'src/main.ts', entry: true, contributions: [] },
        ]);
    });
});
