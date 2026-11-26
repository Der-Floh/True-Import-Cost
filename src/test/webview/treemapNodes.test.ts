import { describe, expect, it } from 'vitest';

import { isSmallerGroup, rebase, tileAction, tileFamily, visibleChildren } from '../../webview/treemap/nodes';
import { groupNode, moduleNode, packageNode, rootNode } from './support/model';

import type { TreemapNodeDto } from '../../shared/dashboard';

const LIMITS = { minimumShare: 0.01, maxTiles: 10 };

function modules(count: number, bytes: number, prefix = 'src/file'): TreemapNodeDto[] {
    return Array.from({ length: count }, (_, index) => moduleNode(`${prefix}-${index}.ts`, bytes));
}

describe('visibleChildren', () => {
    it('keeps every child, largest first, when each is large enough to see', () => {
        const root = rootNode([moduleNode('src/b.ts', 300), moduleNode('src/a.ts', 500), moduleNode('src/c.ts', 200)]);

        expect(visibleChildren(root, LIMITS).map(node => node.label)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    });

    it('folds the children too small to see into one group of smaller items', () => {
        const root = rootNode([moduleNode('src/big.ts', 10_000), ...modules(5, 20, 'src/tiny')]);

        const visible = visibleChildren(root, LIMITS);

        expect(visible.map(node => node.label)).toEqual(['big.ts', '5 smaller items']);
        const group = visible[1]!;
        expect(group).toMatchObject({ bytes: 100, kind: 'other', lazy: false });
        expect(group.children).toHaveLength(5);
        expect(isSmallerGroup(group)).toBe(true);
    });

    it('marks the group lazy only when every member is lazy', () => {
        const lazyOnes = modules(3, 10).map(node => ({ ...node, lazy: true }));
        const root = rootNode([moduleNode('src/big.ts', 10_000), ...lazyOnes]);

        expect(visibleChildren(root, LIMITS)[1]).toMatchObject({ label: '3 smaller items', lazy: true });
        expect(visibleChildren(rootNode([moduleNode('src/big.ts', 10_000), ...lazyOnes, moduleNode('src/eager.ts', 10)]), LIMITS)[1])
            .toMatchObject({ label: '4 smaller items', lazy: false });
    });

    it('does not fold a single small child', () => {
        const root = rootNode([moduleNode('src/big.ts', 10_000), moduleNode('src/tiny.ts', 1)]);

        expect(visibleChildren(root, LIMITS).map(node => node.label)).toEqual(['big.ts', 'tiny.ts']);
    });

    it('shows at most the tile limit, folding the rest', () => {
        const visible = visibleChildren(rootNode(modules(30, 100)), LIMITS);

        expect(visible).toHaveLength(10);
        expect(visible.at(-1)).toMatchObject({ label: '21 smaller items', bytes: 2_100 });
    });

    it('leaves out children without bytes', () => {
        const root = rootNode([moduleNode('src/a.ts', 500), moduleNode('src/empty.ts', 0)]);

        expect(visibleChildren(root, LIMITS).map(node => node.label)).toEqual(['a.ts']);
    });

    it('returns nothing for a leaf', () => {
        expect(visibleChildren(moduleNode('src/a.ts', 500), LIMITS)).toEqual([]);
    });
});

describe('rebase', () => {
    const vue = packageNode('vue', [moduleNode('node_modules/vue/index.js', 600)]);
    const root = rootNode([vue, moduleNode('src/main.ts', 400)]);

    it('follows the same ids into a new tree', () => {
        const grown = packageNode('vue', [moduleNode('node_modules/vue/index.js', 900)]);
        const next = rootNode([grown, moduleNode('src/main.ts', 400)]);

        expect(rebase(next, [vue])).toEqual([grown]);
    });

    it('stops where a node disappeared or has nothing left inside', () => {
        expect(rebase(rootNode([moduleNode('src/main.ts', 400)]), [vue])).toEqual([]);
        expect(rebase(rootNode([packageNode('vue', [])]), [vue])).toEqual([]);
    });

    it('forms a group of smaller items again from the members that are still there', () => {
        const big = rootNode([moduleNode('src/big.ts', 10_000), ...modules(4, 20, 'src/tiny')]);
        const group = visibleChildren(big, LIMITS)[1]!;
        const shrunk = rootNode([moduleNode('src/big.ts', 10_000), ...modules(3, 20, 'src/tiny')]);

        const [rebased] = rebase(shrunk, [group]);

        expect(rebased).toMatchObject({ label: '3 smaller items', bytes: 60 });
        expect(isSmallerGroup(rebased!)).toBe(true);
        expect(rebase(root, [group])).toEqual([]);
    });
});

describe('tileAction', () => {
    it('drills into nodes with contents', () => {
        expect(tileAction(packageNode('vue', [moduleNode('node_modules/vue/index.js', 600)]))).toBe('drill');
    });

    it('opens modules the host can open', () => {
        expect(tileAction(moduleNode('src/main.ts', 10))).toBe('open');
        expect(tileAction(moduleNode('\0virtual', 10, { openable: false }))).toBe('none');
    });

    it('explains a package without recorded modules', () => {
        expect(tileAction(packageNode('vue', []))).toBe('explain');
    });

    it('does nothing for other leaves', () => {
        expect(tileAction({ id: 'other:root', label: '12 smaller', bytes: 10, kind: 'other', lazy: false })).toBe('none');
    });
});

describe('tileFamily', () => {
    const vue = packageNode('vue', [moduleNode('node_modules/vue/index.js', 600)]);
    const project = groupNode('group:project', 'Project sources', 'project', [moduleNode('src/main.ts', 10)]);

    it('colours groups by their own kind', () => {
        expect(tileFamily(vue, [])).toBe('package');
        expect(tileFamily(project, [])).toBe('project');
    });

    it('colours modules like the group they are in', () => {
        expect(tileFamily(moduleNode('node_modules/vue/index.js', 600), [rootNode([vue]), vue])).toBe('package');
        expect(tileFamily(moduleNode('src/main.ts', 10), [rootNode([project]), project])).toBe('project');
        expect(tileFamily(moduleNode('src/main.ts', 10), [rootNode([])])).toBe('other');
    });

    it('looks through groups of smaller items for the family', () => {
        const root = rootNode([moduleNode('node_modules/vue/big.js', 10_000), ...modules(4, 20, 'node_modules/vue/tiny')]);
        const inside = packageNode('vue', root.children ?? []);
        const group = visibleChildren(inside, LIMITS)[1]!;

        expect(tileFamily(moduleNode('node_modules/vue/tiny-0.ts', 20), [rootNode([inside]), inside, group])).toBe('package');
    });
});
