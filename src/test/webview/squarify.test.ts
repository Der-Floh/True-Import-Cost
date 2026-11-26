import { describe, expect, it } from 'vitest';

import { squarify } from '../../webview/treemap/squarify';

import type { Rect, Tile } from '../../webview/treemap/squarify';

const EPSILON = 1e-6;

interface Item {
    readonly id: string;
    readonly bytes: number;
}

const bytesOf = (item: Item): number => item.bytes;

function items(...sizes: number[]): Item[] {
    return sizes.map((bytes, index) => ({ id: `item-${index}`, bytes }));
}

function area(rect: Rect): number {
    return rect.width * rect.height;
}

function overlap(a: Rect, b: Rect): number {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return width > 0 && height > 0 ? width * height : 0;
}

function aspect(rect: Rect): number {
    return Math.max(rect.width / rect.height, rect.height / rect.width);
}

function expectPartition(tiles: readonly Tile<Item>[], bounds: Rect): void {
    const total = tiles.reduce((sum, tile) => sum + tile.item.bytes, 0);
    expect(tiles.reduce((sum, tile) => sum + area(tile), 0)).toBeCloseTo(area(bounds), 6);
    for (const tile of tiles) {
        expect(tile.width).toBeGreaterThan(0);
        expect(tile.height).toBeGreaterThan(0);
        expect(tile.x).toBeGreaterThanOrEqual(bounds.x - EPSILON);
        expect(tile.y).toBeGreaterThanOrEqual(bounds.y - EPSILON);
        expect(tile.x + tile.width).toBeLessThanOrEqual(bounds.x + bounds.width + EPSILON);
        expect(tile.y + tile.height).toBeLessThanOrEqual(bounds.y + bounds.height + EPSILON);
        expect(area(tile) / area(bounds)).toBeCloseTo(tile.item.bytes / total, 9);
    }
    tiles.forEach((tile, index) => {
        for (const other of tiles.slice(index + 1)) {
            expect(overlap(tile, other)).toBeLessThan(EPSILON);
        }
    });
}

function seededSizes(count: number, seed: number): number[] {
    let state = seed;
    return Array.from({ length: count }, () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return 1 + Math.floor((state / 2_147_483_648) ** 3 * 100_000);
    });
}

describe('squarify', () => {
    it('lays out the example of Bruls, Huizing and van Wijk exactly', () => {
        const tiles = squarify(items(6, 6, 4, 3, 2, 2, 1), bytesOf, { x: 0, y: 0, width: 6, height: 4 });

        const rects = tiles.map(({ x, y, width, height }) => [x, y, width, height]);
        const expected = [
            [0, 0, 3, 2],
            [0, 2, 3, 2],
            [3, 0, 12 / 7, 7 / 3],
            [3 + 12 / 7, 0, 9 / 7, 7 / 3],
            [3, 7 / 3, 1.2, 5 / 3],
            [4.2, 7 / 3, 1.2, 5 / 3],
            [5.4, 7 / 3, 0.6, 5 / 3],
        ];
        expect(rects).toHaveLength(expected.length);
        rects.forEach((rect, index) => {
            rect.forEach((value, axis) => expect(value).toBeCloseTo(expected[index]![axis]!, 9));
        });
    });

    it('fills the rectangle without overlaps, with areas proportional to the sizes', () => {
        const bounds = { x: 0, y: 0, width: 960, height: 420 };

        expectPartition(squarify(items(60_000, 45_000, 3_000, 1_500, 700, 12_000), bytesOf, bounds), bounds);
    });

    it('stays a partition for hundreds of skewed sizes', () => {
        const bounds = { x: 0, y: 0, width: 1232, height: 460 };
        const tiles = squarify(items(...seededSizes(400, 7)), bytesOf, bounds);

        expect(tiles).toHaveLength(400);
        expectPartition(tiles, bounds);
    });

    it('respects the position of the bounds', () => {
        const bounds = { x: 40, y: 25, width: 300, height: 500 };
        const tiles = squarify(items(5, 4, 3, 2, 1), bytesOf, bounds);

        expectPartition(tiles, bounds);
        expect(Math.min(...tiles.map(tile => tile.x))).toBeCloseTo(40, 9);
        expect(Math.min(...tiles.map(tile => tile.y))).toBeCloseTo(25, 9);
    });

    it('keeps tiles close to square', () => {
        const tiles = squarify(items(...Array.from({ length: 16 }, () => 1)), bytesOf, { x: 0, y: 0, width: 400, height: 400 });

        expect(Math.max(...tiles.map(aspect))).toBeLessThan(1.6);
    });

    it('returns the tiles largest first, keeping the given order among equal sizes', () => {
        const tiles = squarify(items(1, 5, 3, 5), bytesOf, { x: 0, y: 0, width: 100, height: 100 });

        expect(tiles.map(tile => tile.item.id)).toEqual(['item-1', 'item-3', 'item-2', 'item-0']);
    });

    it('gives a single child the whole rectangle', () => {
        const bounds = { x: 10, y: 20, width: 300, height: 200 };

        expect(squarify(items(42), bytesOf, bounds)).toEqual([{ item: { id: 'item-0', bytes: 42 }, ...bounds }]);
    });

    it('returns nothing for no children, or for children without a size', () => {
        const bounds = { x: 0, y: 0, width: 300, height: 200 };

        expect(squarify([], bytesOf, bounds)).toEqual([]);
        expect(squarify(items(0, 0), bytesOf, bounds)).toEqual([]);
    });

    it('leaves out zero, negative and non-finite sizes and still fills the rectangle', () => {
        const bounds = { x: 0, y: 0, width: 300, height: 200 };
        const tiles = squarify(items(0, 30, -5, Number.NaN, 10, Number.POSITIVE_INFINITY), bytesOf, bounds);

        expect(tiles.map(tile => tile.item.id)).toEqual(['item-1', 'item-4']);
        expectPartition(tiles, bounds);
    });

    it('returns nothing for an empty or invalid rectangle', () => {
        expect(squarify(items(1, 2), bytesOf, { x: 0, y: 0, width: 0, height: 200 })).toEqual([]);
        expect(squarify(items(1, 2), bytesOf, { x: 0, y: 0, width: -10, height: 200 })).toEqual([]);
        expect(squarify(items(1, 2), bytesOf, { x: 0, y: 0, width: Number.NaN, height: 200 })).toEqual([]);
    });
});
