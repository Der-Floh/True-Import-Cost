const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export interface MappingSegment {
    readonly column: number;
    readonly source?: number;
    readonly name?: number;
}

export function encodeVlq(value: number): string {
    let rest = value < 0 ? (-value << 1) | 1 : value << 1;
    let encoded = '';
    do {
        const digit = rest & 31;
        rest >>>= 5;
        encoded += BASE64.charAt(rest > 0 ? digit | 32 : digit);
    } while (rest > 0);
    return encoded;
}

export function encodeMappings(lines: readonly (readonly MappingSegment[])[]): string {
    let source = 0;
    let name = 0;
    return lines.map((segments) => {
        let column = 0;
        return segments.map((segment) => {
            let encoded = encodeVlq(segment.column - column);
            column = segment.column;
            if (segment.source !== undefined) {
                encoded += `${encodeVlq(segment.source - source)}AA`;
                source = segment.source;
                if (segment.name !== undefined) {
                    encoded += encodeVlq(segment.name - name);
                    name = segment.name;
                }
            }
            return encoded;
        }).join(',');
    }).join(';');
}
