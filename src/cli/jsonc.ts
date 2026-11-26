type PieceKind = 'string' | 'comment' | 'comma' | 'close' | 'space' | 'other';

interface Piece {
    readonly kind: PieceKind;
    readonly end: number;
}

const LINE_BREAK = /[\r\n]/g;

const PLAIN_RUN = /[^"/,}\]]+/y;

function stringEnd(text: string, start: number): number {
    for (let index = start + 1; index < text.length; index++) {
        const char = text.charAt(index);
        if (char === '\\') {
            index++;
        } else if (char === '"') {
            return index + 1;
        } else if (char === '\n') {
            return index;
        }
    }
    return text.length;
}

function lineCommentEnd(text: string, start: number): number {
    LINE_BREAK.lastIndex = start;
    return LINE_BREAK.exec(text)?.index ?? text.length;
}

function blockCommentEnd(text: string, start: number): number {
    const close = text.indexOf('*/', start + 2);
    if (close < 0) {
        throw new SyntaxError('a /* comment is never closed');
    }
    return close + 2;
}

function plainRun(text: string, start: number): Piece {
    PLAIN_RUN.lastIndex = start;
    const end = PLAIN_RUN.test(text) ? PLAIN_RUN.lastIndex : start + 1;
    return { kind: /\S/.test(text.slice(start, end)) ? 'other' : 'space', end };
}

function pieceAt(text: string, index: number): Piece {
    const char = text.charAt(index);
    if (char === '"') {
        return { kind: 'string', end: stringEnd(text, index) };
    }
    if (text.startsWith('//', index)) {
        return { kind: 'comment', end: lineCommentEnd(text, index) };
    }
    if (text.startsWith('/*', index)) {
        return { kind: 'comment', end: blockCommentEnd(text, index) };
    }
    if (char === ',') {
        return { kind: 'comma', end: index + 1 };
    }
    if (char === '}' || char === ']') {
        return { kind: 'close', end: index + 1 };
    }
    return plainRun(text, index);
}

export function stripJsonComments(text: string): string {
    const output: string[] = [];
    let trailingComma: number | undefined;
    for (let index = 0; index < text.length;) {
        const piece = pieceAt(text, index);
        const source = text.slice(index, piece.end);
        if (piece.kind === 'comment') {
            output.push(source.replace(/[^\r\n]/g, ' '));
        } else {
            if (piece.kind === 'close' && trailingComma !== undefined) {
                output[trailingComma] = ' ';
            }
            if (piece.kind === 'comma') {
                trailingComma = output.length;
            } else if (piece.kind !== 'space') {
                trailingComma = undefined;
            }
            output.push(source);
        }
        index = piece.end;
    }
    return output.join('');
}

export function parseJsonc(text: string): unknown {
    return JSON.parse(stripJsonComments(text));
}
