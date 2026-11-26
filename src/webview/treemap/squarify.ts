export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface Tile<T> extends Rect {
    readonly item: T;
}

interface Cell<T> {
    readonly item: T;
    readonly area: number;
}

interface Row<T> {
    readonly cells: Cell<T>[];
    sum: number;
    smallest: number;
    largest: number;
}

function worstRatio(sum: number, smallest: number, largest: number, side: number): number {
    const sumSquared = sum * sum;
    const sideSquared = side * side;
    return Math.max((sideSquared * largest) / sumSquared, sumSquared / (sideSquared * smallest));
}

function startRow<T>(cell: Cell<T>): Row<T> {
    return { cells: [cell], sum: cell.area, smallest: cell.area, largest: cell.area };
}

function place<T>(row: Row<T>, bounds: Rect, last: boolean, tiles: Tile<T>[]): Rect {
    const vertical = bounds.width >= bounds.height;
    const length = vertical ? bounds.height : bounds.width;
    const breadth = vertical ? bounds.width : bounds.height;
    const thickness = last ? breadth : Math.min(breadth, row.sum / length);
    let offset = 0;
    row.cells.forEach((cell, index) => {
        const extent = index === row.cells.length - 1 ? length - offset : cell.area / thickness;
        tiles.push(vertical
            ? { item: cell.item, x: bounds.x, y: bounds.y + offset, width: thickness, height: extent }
            : { item: cell.item, x: bounds.x + offset, y: bounds.y, width: extent, height: thickness });
        offset += extent;
    });
    return vertical
        ? { x: bounds.x + thickness, y: bounds.y, width: bounds.width - thickness, height: bounds.height }
        : { x: bounds.x, y: bounds.y + thickness, width: bounds.width, height: bounds.height - thickness };
}

export function squarify<T>(items: readonly T[], weight: (item: T) => number, bounds: Rect): Tile<T>[] {
    const area = bounds.width * bounds.height;
    const weighted = items
        .map(item => ({ item, weight: weight(item) }))
        .filter(entry => Number.isFinite(entry.weight) && entry.weight > 0)
        .sort((a, b) => b.weight - a.weight);
    if (weighted.length === 0 || !(area > 0) || !Number.isFinite(area)) {
        return [];
    }
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    const tiles: Tile<T>[] = [];
    let remaining = bounds;
    let row: Row<T> | undefined;
    for (const entry of weighted) {
        const cell = { item: entry.item, area: (entry.weight / total) * area };
        if (row === undefined) {
            row = startRow(cell);
            continue;
        }
        const side = Math.min(remaining.width, remaining.height);
        const current = worstRatio(row.sum, row.smallest, row.largest, side);
        const extended = worstRatio(row.sum + cell.area, Math.min(row.smallest, cell.area), Math.max(row.largest, cell.area), side);
        if (extended <= current) {
            row.cells.push(cell);
            row.sum += cell.area;
            row.smallest = Math.min(row.smallest, cell.area);
            row.largest = Math.max(row.largest, cell.area);
        } else {
            remaining = place(row, remaining, false, tiles);
            row = startRow(cell);
        }
    }
    if (row !== undefined) {
        place(row, remaining, true, tiles);
    }
    return tiles;
}
