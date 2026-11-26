import { describe, expect, it } from 'vitest';

import { fixture, inPackage } from './support/snapshot';
import { withPackageVersions } from '../../core/adapters/packageVersions';
import { parseSnapshot } from '../../core/schema/validate';

const SNAPSHOT = fixture()
    .module('src/main.ts', 100, { entry: true })
    .module('node_modules/ms/index.js', 40, inPackage('ms'))
    .module('node_modules/ms/util.js', 10, inPackage('ms'))
    .module('node_modules/.pnpm/zod@4.6.7/node_modules/zod/index.js', 60, inPackage('zod', '4.6.7', 'node_modules/.pnpm/zod@4.6.7/node_modules/zod'))
    .module('node_modules/@vue/shared/index.js', 30, inPackage('@vue/shared'))
    .snapshot();

describe('withPackageVersions', () => {
    it('fills in the version of every package root that has none, reading each root once', async () => {
        const reads: string[] = [];

        const result = await withPackageVersions(SNAPSHOT, (root) => {
            reads.push(root);
            return root === 'node_modules/ms' ? '2.1.3' : '3.5.13';
        });

        expect(reads.sort()).toEqual(['node_modules/@vue/shared', 'node_modules/ms']);
        expect(result.modules.map(module => module.packageVersion)).toEqual([undefined, '2.1.3', '2.1.3', '4.6.7', '3.5.13']);
        expect(parseSnapshot(result).ok).toBe(true);
    });

    it('leaves the input snapshot untouched', async () => {
        await withPackageVersions(SNAPSHOT, () => '1.0.0');

        expect(SNAPSHOT.modules.map(module => module.packageVersion)).toEqual([undefined, undefined, undefined, '4.6.7', undefined]);
    });

    it('waits for asynchronous readers', async () => {
        const result = await withPackageVersions(SNAPSHOT, root => Promise.resolve(root.endsWith('ms') ? '2.1.3' : undefined));

        expect(result.modules[1]?.packageVersion).toBe('2.1.3');
        expect(result.modules[4]?.packageVersion).toBeUndefined();
    });

    it('ignores readers that throw, reject or return something that is not a usable version', async () => {
        const answers: Record<string, () => Promise<string | undefined> | string | undefined> = {
            'node_modules/ms': () => {
                throw new Error('EACCES');
            },
            'node_modules/@vue/shared': () => Promise.reject(new Error('ENOENT')),
        };
        const thrown = await withPackageVersions(SNAPSHOT, root => answers[root]?.());

        expect(thrown).toBe(SNAPSHOT);
        for (const version of ['', 'x'.repeat(257), 42 as unknown as string]) {
            expect(await withPackageVersions(SNAPSHOT, () => version)).toBe(SNAPSHOT);
        }
        expect((await withPackageVersions(SNAPSHOT, () => 'x'.repeat(256))).modules[1]?.packageVersion).toHaveLength(256);
    });

    it('returns the same snapshot when no module belongs to a package without a version', async () => {
        const firstParty = fixture().module('src/main.ts', 10).snapshot();
        let called = false;

        expect(await withPackageVersions(firstParty, () => {
            called = true;
            return '1.0.0';
        })).toBe(firstParty);
        expect(called).toBe(false);
    });

    it('keeps the number of reads in flight bounded', async () => {
        const many = Array.from({ length: 40 }, (_, index) => `pkg-${index}`)
            .reduce((builder, name) => builder.module(`node_modules/${name}/index.js`, 10, inPackage(name)), fixture())
            .snapshot();
        let inFlight = 0;
        let peak = 0;

        const result = await withPackageVersions(many, async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight--;
            return '1.0.0';
        });

        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(16);
        expect(result.modules.every(module => module.packageVersion === '1.0.0')).toBe(true);
    });
});
