import { describe, expect, it } from 'vitest';

import { fixture } from './support/snapshot';
import { chunkLoading, lazyBytesByModule, sizeTotals } from '../../core/chunks';

function codeSplitBuild() {
    return fixture()
        .module('src/main.ts', 400, { entry: true, chunk: 'main.js' })
        .module('src/vendor.ts', 300, { chunk: 'vendor.js' })
        .module('src/page.ts', 200, { chunk: 'page.js' })
        .module('src/page-only.ts', 50, { chunk: 'page-vendor.js' })
        .module('src/main.css', 90, { chunk: 'main.css' })
        .module('src/page.css', 30, { chunk: 'page.css' })
        .chunk({ id: 'main.js', bytes: 420, entry: true, imports: ['vendor.js'], dynamicImports: ['page.js'], css: ['main.css'] })
        .chunk({ id: 'vendor.js', bytes: 310 })
        .chunk({ id: 'page.js', bytes: 210, dynamicEntry: true, imports: ['vendor.js', 'page-vendor.js'], css: ['page.css'] })
        .chunk({ id: 'page-vendor.js', bytes: 55 })
        .chunk({ id: 'main.css', bytes: 90 })
        .chunk({ id: 'page.css', bytes: 30 })
        .asset({ id: 'logo.png', kind: 'image', bytes: 1000 })
        .asset({ id: 'main.js.map', kind: 'sourcemap', bytes: 9999 })
        .snapshot();
}

describe('which chunks load initially', () => {
    it('loads the entry chunks, what they import statically and their CSS up front', () => {
        const loading = chunkLoading(codeSplitBuild());

        expect(Object.fromEntries(loading)).toEqual({
            'main.js': 'initial',
            'vendor.js': 'initial',
            'main.css': 'initial',
            'page.js': 'lazy',
            'page-vendor.js': 'lazy',
            'page.css': 'lazy',
        });
    });

    it('treats every chunk as initial when the build names no entry chunk', () => {
        const snapshot = fixture()
            .module('a.ts', 10, { chunk: 'a.js' })
            .chunk({ id: 'a.js', bytes: 10 })
            .chunk({ id: 'b.js', bytes: 20 })
            .snapshot();

        expect([...chunkLoading(snapshot).values()]).toEqual(['initial', 'initial']);
    });

    it('terminates when chunks import each other', () => {
        const snapshot = fixture()
            .chunk({ id: 'a.js', bytes: 1, entry: true, imports: ['b.js'] })
            .chunk({ id: 'b.js', bytes: 1, imports: ['a.js'] })
            .snapshot();

        expect(Object.fromEntries(chunkLoading(snapshot))).toEqual({ 'a.js': 'initial', 'b.js': 'initial' });
    });
});

describe('the size totals of a build', () => {
    it('adds up JavaScript, CSS and assets, and splits chunks into initial and lazy', () => {
        expect(sizeTotals(codeSplitBuild())).toEqual({
            total: 420 + 310 + 210 + 55 + 90 + 30 + 1000,
            javascript: 420 + 310 + 210 + 55,
            css: 120,
            assets: 1000,
            initial: 420 + 310 + 90,
            lazy: 210 + 55 + 30,
        });
    });

    it('leaves source maps out', () => {
        expect(sizeTotals(codeSplitBuild()).assets).toBe(1000);
    });
});

describe('the lazily loaded bytes of each module', () => {
    it('counts only what a module contributes to lazy chunks', () => {
        const lazy = lazyBytesByModule(codeSplitBuild());

        expect(Object.fromEntries(lazy)).toEqual({ 'src/page.ts': 200, 'src/page-only.ts': 50, 'src/page.css': 30 });
    });
});
