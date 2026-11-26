import { describe, expect, it } from 'vitest';

import { isRelativeSpecifier, packageFromPath, parseBareSpecifier } from '../../core/packages';

describe('packageFromPath', () => {
    it('finds an unscoped package and its root', () => {
        expect(packageFromPath('node_modules/react/cjs/react.production.js')).toEqual({ name: 'react', root: 'node_modules/react' });
    });

    it('finds a scoped package under an absolute path', () => {
        expect(packageFromPath('/work/app/node_modules/@vue/shared/dist/shared.esm-bundler.js'))
            .toEqual({ name: '@vue/shared', root: '/work/app/node_modules/@vue/shared' });
    });

    it('uses the innermost node_modules folder for nested installs', () => {
        expect(packageFromPath('node_modules/a/node_modules/b/index.js')).toEqual({ name: 'b', root: 'node_modules/a/node_modules/b' });
    });

    it('reads the version from a pnpm store directory', () => {
        expect(packageFromPath('node_modules/.pnpm/react@18.3.1/node_modules/react/index.js')).toEqual({
            name: 'react',
            root: 'node_modules/.pnpm/react@18.3.1/node_modules/react',
            version: '18.3.1',
        });
    });

    it('reads the version of a scoped package from a pnpm store directory', () => {
        expect(packageFromPath('node_modules/.pnpm/@vue+shared@3.5.13/node_modules/@vue/shared/dist/shared.cjs.js')).toEqual({
            name: '@vue/shared',
            root: 'node_modules/.pnpm/@vue+shared@3.5.13/node_modules/@vue/shared',
            version: '3.5.13',
        });
    });

    it('strips pnpm peer-dependency suffixes from the version', () => {
        expect(packageFromPath('node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/index.js')?.version).toBe('18.3.1');
        expect(packageFromPath('node_modules/.pnpm/react-dom@19.0.0-rc.1(react@19.0.0-rc.1)/node_modules/react-dom/index.js')?.version).toBe('19.0.0-rc.1');
    });

    it('does not take the version of another package from the same store directory', () => {
        expect(packageFromPath('node_modules/.pnpm/react-dom@18.3.1/node_modules/scheduler/index.js')).toEqual({
            name: 'scheduler',
            root: 'node_modules/.pnpm/react-dom@18.3.1/node_modules/scheduler',
        });
    });

    it('reads versions from deno and bun store directories too', () => {
        expect(packageFromPath('node_modules/.deno/chalk@5.3.0/node_modules/chalk/source/index.js')?.version).toBe('5.3.0');
        expect(packageFromPath('node_modules/.bun/@types+node@22.0.0/node_modules/@types/node/index.d.ts')?.version).toBe('22.0.0');
    });

    it('has no version for packages hoisted into the pnpm virtual store root', () => {
        expect(packageFromPath('node_modules/.pnpm/node_modules/ms/index.js')).toEqual({ name: 'ms', root: 'node_modules/.pnpm/node_modules/ms' });
    });

    it('handles Windows paths from a pnpm store', () => {
        expect(packageFromPath('C:\\work\\app\\node_modules\\.pnpm\\lodash@4.17.21\\node_modules\\lodash\\lodash.js')).toEqual({
            name: 'lodash',
            root: 'C:/work/app/node_modules/.pnpm/lodash@4.17.21/node_modules/lodash',
            version: '4.17.21',
        });
    });

    it('ignores a query and a rollup virtual-module prefix', () => {
        expect(packageFromPath('\0/work/app/node_modules/ms/index.js?commonjs-proxy')).toEqual({ name: 'ms', root: '/work/app/node_modules/ms' });
    });

    it('returns nothing for paths that are not inside a package', () => {
        expect(packageFromPath('src/main.ts')).toBeUndefined();
        expect(packageFromPath('node_modules')).toBeUndefined();
        expect(packageFromPath('node_modules/')).toBeUndefined();
        expect(packageFromPath('node_modules/.bin/vite')).toBeUndefined();
        expect(packageFromPath('node_modules/@scope')).toBeUndefined();
        expect(packageFromPath('node_modules/@scope/')).toBeUndefined();
    });
});

describe('isRelativeSpecifier', () => {
    it('accepts dot and dot-dot specifiers', () => {
        expect(['.', '..', './util', '../lib/util'].map(isRelativeSpecifier)).toEqual([true, true, true, true]);
    });

    it('rejects bare names that merely start with a dot', () => {
        expect(['.env', '...', 'lodash', '/abs/path'].map(isRelativeSpecifier)).toEqual([false, false, false, false]);
    });
});

describe('parseBareSpecifier', () => {
    it('splits a package name from its subpath', () => {
        expect(parseBareSpecifier('react')).toEqual({ packageName: 'react', subpath: '' });
        expect(parseBareSpecifier('lodash/fp/map')).toEqual({ packageName: 'lodash', subpath: 'fp/map' });
    });

    it('keeps the scope as part of the package name', () => {
        expect(parseBareSpecifier('@vue/runtime-dom')).toEqual({ packageName: '@vue/runtime-dom', subpath: '' });
        expect(parseBareSpecifier('@scope/pkg/sub/path.js')).toEqual({ packageName: '@scope/pkg', subpath: 'sub/path.js' });
    });

    it('rejects relative, absolute and URL-like specifiers', () => {
        for (const specifier of ['', '.', './util', '../util', '/src/main.ts', 'node:fs', 'https://esm.sh/react', 'virtual:pwa-register', 'C:/lib/index.js']) {
            expect(parseBareSpecifier(specifier), specifier).toBeUndefined();
        }
    });

    it('rejects incomplete scoped names, such as an "@/" path alias', () => {
        expect(parseBareSpecifier('@scope')).toBeUndefined();
        expect(parseBareSpecifier('@scope/')).toBeUndefined();
        expect(parseBareSpecifier('@/components/Button.vue')).toBeUndefined();
    });
});
