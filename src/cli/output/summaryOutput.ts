import { code, printable } from './escape';
import { buildLine, ESTIMATE_NOTE, sizeText, TOTAL_LABELS } from './format';
import { markdownTable, textTable } from './table';
import { TOTAL_KEYS } from '../reports/model';

import type { Column, Row } from './table';
import type { SummaryReport } from '../reports/model';

interface InstanceRow {
    readonly name: string;
    readonly version?: string;
    readonly root: string;
    readonly size: string;
}

const SIZE_COLUMNS: readonly Column[] = [{ title: '', align: 'left' }, { title: 'Size', align: 'right' }];

function totalsRows(report: SummaryReport): Row[] {
    return TOTAL_KEYS.map(key => [TOTAL_LABELS[key], sizeText(report.totals[key])]);
}

function packagesTitle(report: SummaryReport): string {
    return report.packageCount === 0 ? 'Packages: none bundled' : `Largest packages: ${report.packages.length} of ${report.packageCount}`;
}

function instanceRows(report: SummaryReport): InstanceRow[] {
    return report.duplicates.flatMap(duplicate => duplicate.instances.map(instance => ({
        name: duplicate.name,
        ...(instance.version === undefined ? {} : { version: instance.version }),
        root: instance.root,
        size: sizeText(instance.bytes, report.build.estimated),
    })));
}

function packagesText(report: SummaryReport): string[] {
    const estimated = report.build.estimated;
    const columns: Column[] = [{ title: 'Size', align: 'right' }, { title: 'Lazy', align: 'right' }, { title: 'Package', align: 'left' }];
    const rows = report.packages.map(item => [
        sizeText(item.bytes, estimated),
        sizeText(item.lazyBytes, estimated),
        printable(item.versions.length === 0 ? item.name : `${item.name} ${item.versions.join(', ')}`),
    ]);
    return [packagesTitle(report), ...(rows.length === 0 ? [] : textTable(columns, rows))];
}

function duplicatesText(report: SummaryReport): string[] {
    if (report.duplicates.length === 0) {
        return ['Duplicate packages: none'];
    }
    const columns: Column[] = [{ title: 'Size', align: 'right' }, { title: 'Package', align: 'left' }];
    const rows = instanceRows(report).map(row => [row.size, printable(`${row.version === undefined ? row.name : `${row.name} ${row.version}`} in ${row.root}`)]);
    return [`Duplicate packages: ${report.duplicates.length}`, ...textTable(columns, rows)];
}

export function summaryText(report: SummaryReport): string {
    const lines = [
        `Bundle summary of ${printable(report.build.target)}: ${buildLine(report.build, printable)}`,
        '',
        'Sizes',
        ...textTable(SIZE_COLUMNS, totalsRows(report), false),
        '',
        ...packagesText(report),
        '',
        ...duplicatesText(report),
        ...(report.build.estimated ? ['', ESTIMATE_NOTE] : []),
    ];
    return `${lines.join('\n')}\n`;
}

function packagesMarkdown(report: SummaryReport): string[] {
    if (report.packages.length === 0) {
        return [`#### ${packagesTitle(report)}`];
    }
    const estimated = report.build.estimated;
    const columns: Column[] = [
        { title: 'Package', align: 'left' },
        { title: 'Versions', align: 'left' },
        { title: 'Size', align: 'right' },
        { title: 'Lazily loaded', align: 'right' },
    ];
    const rows = report.packages.map(item => [
        code(item.name),
        item.versions.map(code).join(', '),
        sizeText(item.bytes, estimated),
        sizeText(item.lazyBytes, estimated),
    ]);
    return [`#### ${packagesTitle(report)}`, '', ...markdownTable(columns, rows)];
}

function duplicatesMarkdown(report: SummaryReport): string[] {
    if (report.duplicates.length === 0) {
        return [];
    }
    const columns: Column[] = [{ title: 'Package', align: 'left' }, { title: 'Version', align: 'left' }, { title: 'Location', align: 'left' }, { title: 'Size', align: 'right' }];
    const rows = instanceRows(report).map(row => [code(row.name), row.version === undefined ? '' : code(row.version), code(row.root), row.size]);
    return ['', `#### Duplicate packages: ${report.duplicates.length}`, '', ...markdownTable(columns, rows)];
}

export function summaryMarkdown(report: SummaryReport): string {
    const lines = [
        `### Bundle summary of ${code(report.build.target)}`,
        '',
        `Built by ${buildLine(report.build, code)}.`,
        '',
        ...markdownTable(SIZE_COLUMNS, totalsRows(report)),
        '',
        ...packagesMarkdown(report),
        ...duplicatesMarkdown(report),
        ...(report.build.estimated ? ['', ESTIMATE_NOTE] : []),
    ];
    return `${lines.join('\n')}\n`;
}
