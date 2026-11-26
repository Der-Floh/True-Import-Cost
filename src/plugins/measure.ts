import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describeError } from './shared';
import { MEASURE_ENV, MEASURE_VERSION, measureReportFile, parseMeasureRequest } from '../core/measureProtocol';

import type { MeasureReport, MeasureRequest, SourceEdit } from '../core/measureProtocol';

export { MEASURE_ENV, MEASURE_VERSION, measureReportFile } from '../core/measureProtocol';
export type { MeasureReport, MeasureRequest, SourceEdit } from '../core/measureProtocol';

const BYTE_ORDER_MARK = '\uFEFF';

export function readMeasureRequest(env: Readonly<Record<string, string | undefined>> = process.env): MeasureRequest | undefined {
    const file = env[MEASURE_ENV];
    if (file === undefined || file === '') {
        return undefined;
    }
    let value: unknown;
    try {
        value = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error: unknown) {
        throw new Error(`${MEASURE_ENV} names a measurement request that cannot be read: ${describeError(error)}`);
    }
    const request = parseMeasureRequest(value);
    if (!request) {
        throw new Error(`${MEASURE_ENV} names a file that is not a True Import Cost measurement request of version ${MEASURE_VERSION}.`);
    }
    return request;
}

function fileKey(file: string): string {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertSeparate(edits: readonly SourceEdit[]): void {
    const ordered = [...edits].sort((a, b) => a.start - b.start);
    ordered.forEach((edit, index) => {
        const next = ordered[index + 1];
        if (next !== undefined && next.start < edit.end) {
            throw new Error(`Two measurement edits of ${edit.file} overlap.`);
        }
    });
}

export class SourceEdits {
    private readonly byFile = new Map<string, readonly SourceEdit[]>();
    private readonly applied = new Set<string>();

    public constructor(edits: readonly SourceEdit[]) {
        const grouped = new Map<string, SourceEdit[]>();
        for (const edit of edits) {
            const key = fileKey(edit.file);
            grouped.set(key, [...(grouped.get(key) ?? []), edit]);
        }
        for (const [key, group] of grouped) {
            assertSeparate(group);
            this.byFile.set(key, [...group].sort((a, b) => b.start - a.start));
        }
    }

    public get size(): number {
        return this.byFile.size;
    }

    public has(file: string): boolean {
        return this.byFile.has(fileKey(file));
    }

    public filter(): RegExp {
        const names = [...new Set([...this.byFile.values()].flatMap(edits => edits.map(edit => path.basename(edit.file))))];
        return new RegExp(`(^|[\\\\/])(${names.map(escapeRegExp).join('|')})$`, process.platform === 'win32' ? 'i' : '');
    }

    public apply(file: string, source: string): string {
        const key = fileKey(file);
        const edits = this.byFile.get(key);
        if (!edits) {
            return source;
        }
        let text = source.startsWith(BYTE_ORDER_MARK) ? source.slice(BYTE_ORDER_MARK.length) : source;
        for (const edit of edits) {
            if (text.slice(edit.start, edit.end) !== edit.expected) {
                throw new Error(`${edit.file} changed after True Import Cost planned the measurement; save it and measure again.`);
            }
            text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
        }
        this.applied.add(key);
        return text;
    }

    public report(target: string): MeasureReport {
        const files = [...this.byFile].map(([key, edits]) => ({ key, file: edits[0]?.file ?? key }));
        return {
            version: MEASURE_VERSION,
            target,
            applied: files.filter(({ key }) => this.applied.has(key)).map(({ file }) => file),
            missing: files.filter(({ key }) => !this.applied.has(key)).map(({ file }) => file),
        };
    }
}

export async function writeMeasureReport(snapshotFile: string, report: MeasureReport): Promise<void> {
    await mkdir(path.dirname(snapshotFile), { recursive: true });
    await writeFile(measureReportFile(snapshotFile), JSON.stringify(report));
}
