export const MEASURE_ENV = 'TRUE_IMPORT_COST_MEASURE';

export const MEASURE_VERSION = 1;

const MAX_EDITS = 100;

const MAX_EDIT_LENGTH = 100_000;

const MAX_REPORTED_FILES = 1_000;

export interface SourceEdit {
    readonly file: string;
    readonly start: number;
    readonly end: number;
    readonly expected: string;
    readonly replacement: string;
}

export interface MeasureRequest {
    readonly version: typeof MEASURE_VERSION;
    readonly outDir: string;
    readonly edits: readonly SourceEdit[];
}

export interface MeasureReport {
    readonly version: typeof MEASURE_VERSION;
    readonly target: string;
    readonly applied: readonly string[];
    readonly missing: readonly string[];
}

export function isAbsoluteFilePath(value: string): boolean {
    return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value);
}

function isOffset(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length <= MAX_EDIT_LENGTH;
}

function isEdit(value: unknown): value is SourceEdit {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const edit = value as Partial<Record<keyof SourceEdit, unknown>>;
    return typeof edit.file === 'string' && isAbsoluteFilePath(edit.file)
        && isOffset(edit.start) && isOffset(edit.end) && edit.start <= edit.end
        && isText(edit.expected) && edit.expected.length === edit.end - edit.start
        && isText(edit.replacement);
}

export function parseMeasureRequest(value: unknown): MeasureRequest | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const request = value as Partial<Record<keyof MeasureRequest, unknown>>;
    if (request.version !== MEASURE_VERSION || typeof request.outDir !== 'string' || !isAbsoluteFilePath(request.outDir)) {
        return undefined;
    }
    if (!Array.isArray(request.edits) || request.edits.length > MAX_EDITS || !request.edits.every(isEdit)) {
        return undefined;
    }
    return { version: MEASURE_VERSION, outDir: request.outDir, edits: request.edits };
}

function isFileList(value: unknown): value is string[] {
    return Array.isArray(value) && value.length <= MAX_REPORTED_FILES && value.every(item => typeof item === 'string');
}

export function parseMeasureReport(value: unknown): MeasureReport | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const report = value as Partial<Record<keyof MeasureReport, unknown>>;
    if (report.version !== MEASURE_VERSION || typeof report.target !== 'string' || !isFileList(report.applied) || !isFileList(report.missing)) {
        return undefined;
    }
    return { version: MEASURE_VERSION, target: report.target, applied: report.applied, missing: report.missing };
}

export function measureReportFile(snapshotFile: string): string {
    return `${snapshotFile.replace(/\.json$/i, '')}.edits.json`;
}
