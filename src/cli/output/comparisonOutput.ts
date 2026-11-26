import { code, printable } from './escape';
import { buildLine, changeText, deltaText, ESTIMATE_NOTE, percentText, sizeText, TOTAL_LABELS } from './format';
import { markdownTable, textTable } from './table';
import { TOTAL_KEYS } from '../reports/model';

import type { Column, Row } from './table';
import type { ChunkChange, ComparisonReport, PackageChange } from '../reports/model';

type Wrap = (text: string) => string;

interface Entry {
    readonly before: string;
    readonly after: string;
    readonly delta: string;
    readonly label: string;
}

interface Section {
    readonly title: string;
    readonly label: string;
    readonly entries: readonly Entry[];
    readonly hidden: number;
}

interface Sections {
    readonly packages: Section;
    readonly chunks: Section;
    readonly modules: Section;
}

const SIZE_CHANGE_COLUMNS: readonly Column[] = [
    { title: 'Baseline', align: 'right' },
    { title: 'Current', align: 'right' },
    { title: 'Change', align: 'right' },
];

const LABEL_COLUMN: Column = { title: '', align: 'left' };

function isEstimated(report: ComparisonReport): boolean {
    return report.baseline.estimated || report.current.estimated;
}

function subject(report: ComparisonReport, wrap: Wrap, joiner: string): string {
    const { baseline, current } = report;
    return baseline.target === current.target ? wrap(current.target) : `${wrap(current.target)} ${joiner} ${wrap(baseline.target)}`;
}

function totalChange(report: ComparisonReport): string | undefined {
    return report.totals.total.delta === 0 ? undefined : changeText(report.totals.total);
}

function versionList(versions: readonly string[], wrap: Wrap): string {
    return versions.map(wrap).join(', ');
}

function named(name: string, versions: readonly string[], wrap: Wrap): string {
    return versions.length === 0 ? wrap(name) : `${wrap(name)} ${versionList(versions, wrap)}`;
}

function packageLabel(change: PackageChange, wrap: Wrap): string {
    const { name, versionsBefore, versionsAfter } = change;
    if (change.status === 'added') {
        return `${named(name, versionsAfter, wrap)} (added)`;
    }
    if (change.status === 'removed') {
        return `${named(name, versionsBefore, wrap)} (removed)`;
    }
    const versionsChanged = versionsBefore.length > 0 && versionsAfter.length > 0 && versionsBefore.join() !== versionsAfter.join();
    return versionsChanged
        ? `${wrap(name)} ${versionList(versionsBefore, wrap)} -> ${versionList(versionsAfter, wrap)}`
        : named(name, versionsAfter.length > 0 ? versionsAfter : versionsBefore, wrap);
}

function chunkLabel(change: ChunkChange, wrap: Wrap): string {
    if (change.after === undefined) {
        return `${wrap(change.before ?? '')} (removed)`;
    }
    return change.before === undefined ? `${wrap(change.after)} (added)` : wrap(change.after);
}

function packagesTitle(report: ComparisonReport): string {
    const { added, removed, changed, unchanged } = report.packages;
    const counts: readonly (readonly [number, string])[] = [[added, 'added'], [removed, 'removed'], [changed, 'changed'], [unchanged, 'unchanged']];
    const parts = counts.filter(([count]) => count > 0).map(([count, word]) => `${count} ${word}`);
    return `Packages: ${parts.length === 0 ? 'none' : parts.join(', ')}`;
}

function countTitle(name: string, changed: number): string {
    return `${name}: ${changed === 0 ? 'no changes' : `${changed} changed`}`;
}

function entry(before: number, after: number, delta: number, label: string, estimated: boolean): Entry {
    return { before: sizeText(before, estimated), after: sizeText(after, estimated), delta: deltaText(delta, estimated), label };
}

function sections(report: ComparisonReport, wrap: Wrap): Sections {
    const estimated = isEstimated(report);
    const { packages, chunks, modules } = report;
    return {
        packages: {
            title: packagesTitle(report),
            label: 'Package',
            entries: packages.changes.map(change => entry(change.before, change.after, change.delta, packageLabel(change, wrap), estimated)),
            hidden: packages.added + packages.removed + packages.changed - packages.changes.length,
        },
        chunks: {
            title: countTitle('Chunks', chunks.changed),
            label: 'Chunk',
            entries: chunks.changes.map(change => entry(change.bytesBefore, change.bytesAfter, change.delta, chunkLabel(change, wrap), false)),
            hidden: chunks.changed - chunks.changes.length,
        },
        modules: {
            title: countTitle('Modules', modules.changed),
            label: 'Module',
            entries: modules.changes.map(change => entry(change.before, change.after, change.delta, wrap(change.label), estimated)),
            hidden: modules.changed - modules.changes.length,
        },
    };
}

function moreLines(section: Section, indent: string): string[] {
    return section.hidden > 0 ? [`${indent}... and ${section.hidden} more`] : [];
}

function sizesText(report: ComparisonReport): string[] {
    const columns: Column[] = [LABEL_COLUMN, ...SIZE_CHANGE_COLUMNS, { title: '', align: 'right' }];
    const rows = TOTAL_KEYS.map((key): Row => {
        const change = report.totals[key];
        return [TOTAL_LABELS[key], sizeText(change.before), sizeText(change.after), deltaText(change.delta), percentText(change)];
    });
    return ['Sizes', ...textTable(columns, rows)];
}

function sectionText(section: Section): string[] {
    if (section.entries.length === 0) {
        return [section.title];
    }
    const columns: Column[] = [...SIZE_CHANGE_COLUMNS, { title: section.label, align: 'left' }];
    const rows = section.entries.map((item): Row => [item.before, item.after, item.delta, item.label]);
    return [section.title, ...textTable(columns, rows), ...moreLines(section, '  ')];
}

export function comparisonText(report: ComparisonReport): string {
    const { packages, chunks, modules } = sections(report, printable);
    const lines = [
        `Comparison of ${subject(report, printable, 'with')}: ${totalChange(report) ?? 'no change'} in total`,
        ...textTable([LABEL_COLUMN, LABEL_COLUMN], [
            ['Baseline', buildLine(report.baseline, printable)],
            ['Current', buildLine(report.current, printable)],
        ], false),
        '',
        ...sizesText(report),
        ...[packages, chunks, modules].flatMap(section => ['', ...sectionText(section)]),
        ...(isEstimated(report) ? ['', ESTIMATE_NOTE] : []),
    ];
    return `${lines.join('\n')}\n`;
}

function buildsMarkdown(report: ComparisonReport): string[] {
    const baseline = buildLine(report.baseline, code);
    const current = buildLine(report.current, code);
    return baseline === current ? [] : [`Baseline built by ${baseline}, current build by ${current}.`, ''];
}

function sizesMarkdown(report: ComparisonReport): string[] {
    const rows = TOTAL_KEYS.map((key): Row => {
        const change = report.totals[key];
        return [TOTAL_LABELS[key], sizeText(change.before), sizeText(change.after), changeText(change)];
    });
    return markdownTable([LABEL_COLUMN, ...SIZE_CHANGE_COLUMNS], rows);
}

function sectionTable(section: Section): string[] {
    const columns: Column[] = [{ title: section.label, align: 'left' }, ...SIZE_CHANGE_COLUMNS];
    const rows = section.entries.map((item): Row => [item.label, item.before, item.after, item.delta]);
    const more = moreLines(section, '');
    return [...markdownTable(columns, rows), ...(more.length === 0 ? [] : ['', ...more])];
}

function openSectionMarkdown(section: Section): string[] {
    return section.entries.length === 0 ? ['', `#### ${section.title}`] : ['', `#### ${section.title}`, '', ...sectionTable(section)];
}

function collapsedSectionMarkdown(section: Section): string[] {
    return section.entries.length === 0 ? [] : ['', '<details>', `<summary>${section.title}</summary>`, '', ...sectionTable(section), '', '</details>'];
}

export function comparisonMarkdown(report: ComparisonReport): string {
    const { packages, chunks, modules } = sections(report, code);
    const lines = [
        `### Bundle size of ${subject(report, code, 'compared with')}: ${totalChange(report) ?? 'no change'}`,
        '',
        ...buildsMarkdown(report),
        ...sizesMarkdown(report),
        ...openSectionMarkdown(packages),
        ...collapsedSectionMarkdown(chunks),
        ...collapsedSectionMarkdown(modules),
        ...(isEstimated(report) ? ['', ESTIMATE_NOTE] : []),
    ];
    return `${lines.join('\n')}\n`;
}
