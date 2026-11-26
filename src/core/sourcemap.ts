const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_VALUES = new Map([...BASE64].map((character, index) => [character.charCodeAt(0), index]));

export interface SourceMapLike {
    readonly sources: readonly (string | null)[];
    readonly mappings: string;
    readonly sourceRoot?: string;
}

function decodeSegment(segment: string, values: number[]): void {
    values.length = 0;
    let value = 0;
    let shift = 0;
    for (let index = 0; index < segment.length; index++) {
        const digit = BASE64_VALUES.get(segment.charCodeAt(index));
        if (digit === undefined) {
            throw new Error(`invalid base64 VLQ character "${segment.charAt(index)}"`);
        }
        value += (digit & 31) << shift;
        if ((digit & 32) === 0) {
            const negative = (value & 1) === 1;
            const magnitude = value >>> 1;
            values.push(negative ? -magnitude : magnitude);
            value = 0;
            shift = 0;
        } else {
            shift += 5;
        }
    }
}

export function bytesPerSource(code: string, map: SourceMapLike): number[] {
    const totals: number[] = map.sources.map(() => 0);
    const lines = code.split('\n');
    const mappingLines = map.mappings.split(';');
    const values: number[] = [];
    let sourceIndex = 0;

    for (let line = 0; line < mappingLines.length && line < lines.length; line++) {
        const mappingLine = mappingLines[line] ?? '';
        if (mappingLine === '') {
            continue;
        }
        const lineLength = (lines[line] ?? '').length;
        const segments: { column: number; source: number | undefined }[] = [];
        let column = 0;
        for (const segment of mappingLine.split(',')) {
            if (segment === '') {
                continue;
            }
            decodeSegment(segment, values);
            column += values[0] ?? 0;
            if (values.length >= 4) {
                sourceIndex += values[1] ?? 0;
                segments.push({ column, source: sourceIndex });
            } else {
                segments.push({ column, source: undefined });
            }
        }
        for (let index = 0; index < segments.length; index++) {
            const current = segments[index];
            if (current?.source === undefined) {
                continue;
            }
            const end = Math.min(segments[index + 1]?.column ?? lineLength, lineLength);
            const span = end - current.column;
            if (span > 0 && current.source >= 0 && current.source < totals.length) {
                totals[current.source] = (totals[current.source] ?? 0) + span;
            }
        }
    }
    return totals;
}
