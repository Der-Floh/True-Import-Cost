import { describe, expect, it } from 'vitest';

import { chunkRecord, fixture, inPackage } from './support/snapshot';
import { chunkKey, compareBuilds } from '../../core/compare';

function baseline() {
    return fixture()
        .module('src/main.ts', 100, { entry: true, chunk: 'assets/index-AB12cd34.js' })
        .module('node_modules/lodash-es/debounce.js', 900, { ...inPackage('lodash-es', '4.17.20'), chunk: 'assets/index-AB12cd34.js' })
        .module('node_modules/moment/moment.js', 5000, { ...inPackage('moment', '2.29.0'), chunk: 'assets/index-AB12cd34.js' })
        .module('node_modules/vue/index.js', 2000, { ...inPackage('vue', '3.5.0'), chunk: 'assets/index-AB12cd34.js' })
        .chunk({ id: 'assets/index-AB12cd34.js', bytes: 8000, entry: true, entryModule: 'src/main.ts' })
        .chunk({ id: 'assets/Lazy-Qq9ZxY10.js', bytes: 300, dynamicEntry: true })
        .graph();
}

function splitBuild(chunks: readonly (readonly [string, number, readonly string[]])[]) {
    const build = fixture();
    for (const [id, bytes, modules] of chunks) {
        for (const module of modules) {
            build.module(module, 10, { chunk: id });
        }
        build.chunk({ id, bytes });
    }
    return build.graph();
}

function current() {
    return fixture()
        .module('src/main.ts', 120, { entry: true, chunk: 'assets/index-ZZ99yy88.js' })
        .module('node_modules/lodash-es/debounce.js', 950, { ...inPackage('lodash-es', '4.17.21'), chunk: 'assets/index-ZZ99yy88.js' })
        .module('node_modules/dayjs/dayjs.js', 700, { ...inPackage('dayjs', '1.11.0'), chunk: 'assets/index-ZZ99yy88.js' })
        .module('node_modules/vue/index.js', 2000, { ...inPackage('vue', '3.5.0'), chunk: 'assets/index-ZZ99yy88.js' })
        .chunk({ id: 'assets/index-ZZ99yy88.js', bytes: 3800, entry: true, entryModule: 'src/main.ts' })
        .chunk({ id: 'assets/Lazy-Rr0ZxY11.js', bytes: 280, dynamicEntry: true })
        .graph();
}

describe('comparing two builds of a target', () => {
    it('reports the totals of both builds', () => {
        const comparison = compareBuilds(baseline(), current());

        expect(comparison.before.javascript).toBe(8300);
        expect(comparison.after.javascript).toBe(4080);
    });

    it('lists added, removed, changed and unchanged packages, largest change first', () => {
        const packages = compareBuilds(baseline(), current()).packages;

        expect(packages.map(item => [item.name, item.status, item.delta])).toEqual([
            ['moment', 'removed', -5000],
            ['dayjs', 'added', 700],
            ['lodash-es', 'changed', 50],
            ['vue', 'unchanged', 0],
        ]);
    });

    it('records version changes, and calls a package whose version changed changed even at the same size', () => {
        const before = fixture().module('node_modules/a/i.js', 10, inPackage('a', '1.0.0')).graph();
        const after = fixture().module('node_modules/a/i.js', 10, inPackage('a', '2.0.0')).graph();
        const [change] = compareBuilds(before, after).packages;

        expect(change).toMatchObject({ status: 'changed', delta: 0, versionsBefore: ['1.0.0'], versionsAfter: ['2.0.0'] });
    });

    it('adds the instances of a package installed twice together', () => {
        const after = fixture()
            .module('node_modules/a/i.js', 10, inPackage('a', '1.0.0'))
            .module('node_modules/b/node_modules/a/i.js', 15, inPackage('a', '2.0.0', 'node_modules/b/node_modules/a'))
            .graph();
        const [change] = compareBuilds(fixture().graph(), after).packages;

        expect(change).toMatchObject({ name: 'a', after: 25, versionsAfter: ['1.0.0', '2.0.0'], status: 'added' });
    });

    it('matches chunks across builds by entry module, or by file name without its content hash', () => {
        const chunks = compareBuilds(baseline(), current()).chunks;

        expect(chunks.map(item => [item.key, item.before, item.after, item.delta])).toEqual([
            ['js:src/main.ts', 'assets/index-AB12cd34.js', 'assets/index-ZZ99yy88.js', -4200],
            ['js:assets/Lazy.js', 'assets/Lazy-Qq9ZxY10.js', 'assets/Lazy-Rr0ZxY11.js', -20],
        ]);
    });

    it('pairs chunks that share a name without its hash by the modules they hold', () => {
        const before = splitBuild([['dist/chunk-AAAA1111.js', 100, ['src/a.ts', 'src/b.ts']], ['dist/chunk-BBBB2222.js', 50, ['src/c.ts']]]);
        const after = splitBuild([['dist/chunk-CCCC3333.js', 80, ['src/c.ts', 'src/d.ts']], ['dist/chunk-DDDD4444.js', 90, ['src/a.ts', 'src/b.ts']]]);

        expect(compareBuilds(before, after).chunks.map(item => [item.key, item.before, item.after, item.delta])).toEqual([
            ['js:dist/chunk.js', 'dist/chunk-BBBB2222.js', 'dist/chunk-CCCC3333.js', 30],
            ['js:dist/chunk.js', 'dist/chunk-AAAA1111.js', 'dist/chunk-DDDD4444.js', -10],
        ]);
    });

    it('reports a chunk of a shared name with nothing in common as removed or added', () => {
        const before = splitBuild([['dist/chunk-AAAA1111.js', 100, ['src/a.ts']], ['dist/chunk-BBBB2222.js', 50, ['src/b.ts']]]);
        const after = splitBuild([['dist/chunk-CCCC3333.js', 100, ['src/a.ts']], ['dist/chunk-DDDD4444.js', 70, ['src/x.ts']], ['dist/chunk-EEEE5555.js', 20, ['src/y.ts']]]);

        expect(compareBuilds(before, after).chunks.map(item => [item.before, item.after, item.delta])).toEqual([
            [undefined, 'dist/chunk-DDDD4444.js', 70],
            ['dist/chunk-BBBB2222.js', undefined, -50],
            [undefined, 'dist/chunk-EEEE5555.js', 20],
            ['dist/chunk-AAAA1111.js', 'dist/chunk-CCCC3333.js', 0],
        ]);
    });

    it('pairs the only chunk of a name even when everything in it changed', () => {
        const before = splitBuild([['dist/vendor-AAAA1111.js', 100, ['src/a.ts']]]);
        const after = splitBuild([['dist/vendor-BBBB2222.js', 120, ['src/b.ts']]]);

        expect(compareBuilds(before, after).chunks.map(item => [item.before, item.after, item.delta])).toEqual([
            ['dist/vendor-AAAA1111.js', 'dist/vendor-BBBB2222.js', 20],
        ]);
    });

    it('lists the modules that changed, largest change first, and only those', () => {
        const modules = compareBuilds(baseline(), current()).modules;

        expect(modules.map(item => [item.id, item.delta])).toEqual([
            ['node_modules/moment/moment.js', -5000],
            ['node_modules/dayjs/dayjs.js', 700],
            ['node_modules/lodash-es/debounce.js', 50],
            ['src/main.ts', 20],
        ]);
    });

    it('caps the module list', () => {
        expect(compareBuilds(baseline(), current(), 2).modules).toHaveLength(2);
    });
});

describe('the key a chunk is matched by', () => {
    it.each([
        ['assets/index-DDhTxJY7.js', 'js:assets/index.js'],
        ['assets/Lazy-n-ewKlwO.js', 'js:assets/Lazy.js'],
        ['dist/lazy-EQO2KQQD.js', 'js:dist/lazy.js'],
        ['dist/extension.js', 'js:dist/extension.js'],
        ['assets/my-component.js', 'js:assets/my-component.js'],
        ['assets/settings.js', 'js:assets/settings.js'],
    ])('keys %s as %s', (id, key) => {
        expect(chunkKey(chunkRecord({ id, bytes: 1 }))).toBe(key);
    });

    it('prefers the entry module', () => {
        expect(chunkKey(chunkRecord({ id: 'assets/x-AAAA1111.css', bytes: 1, entryModule: 'src/a.ts' }))).toBe('css:src/a.ts');
    });
});
