import { tableCell } from './escape';

export interface Column {
    readonly title: string;
    readonly align: 'left' | 'right';
}

export type Row = readonly string[];

const INDENT = '  ';

function widthsOf(columns: readonly Column[], rows: readonly Row[]): number[] {
    return columns.map((column, index) => rows.reduce((width, row) => Math.max(width, (row[index] ?? '').length), column.title.length));
}

function alignedLine(columns: readonly Column[], widths: readonly number[], cells: Row): string {
    const aligned = columns.map((column, index) => {
        const cell = cells[index] ?? '';
        const width = widths[index] ?? 0;
        if (column.align === 'right') {
            return cell.padStart(width);
        }
        return index === columns.length - 1 ? cell : cell.padEnd(width);
    });
    return `${INDENT}${aligned.join('  ')}`.trimEnd();
}

export function textTable(columns: readonly Column[], rows: readonly Row[], header = true): string[] {
    const widths = widthsOf(columns, rows);
    const lines = rows.map(row => alignedLine(columns, widths, row));
    return header ? [alignedLine(columns, widths, columns.map(column => column.title)), ...lines] : lines;
}

export function markdownTable(columns: readonly Column[], rows: readonly Row[]): string[] {
    return [
        `| ${columns.map(column => column.title).join(' | ')} |`,
        `| ${columns.map(column => (column.align === 'right' ? '---:' : '---')).join(' | ')} |`,
        ...rows.map(row => `| ${row.map(tableCell).join(' | ')} |`),
    ];
}
