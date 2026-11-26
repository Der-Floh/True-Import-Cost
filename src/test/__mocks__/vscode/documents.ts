import { hostEvent } from './events';
import { setVirtualFile } from './fileSystem';
import { Uri } from './uri';

import type { Disposable } from './events';

export class Position {
    public readonly line: number;
    public readonly character: number;

    public constructor(line: number, character: number) {
        this.line = line;
        this.character = character;
    }

    public compareTo(other: Position): number {
        return Math.sign(this.line - other.line || this.character - other.character);
    }

    public isBefore(other: Position): boolean {
        return this.compareTo(other) < 0;
    }

    public isAfter(other: Position): boolean {
        return this.compareTo(other) > 0;
    }

    public isEqual(other: Position): boolean {
        return this.compareTo(other) === 0;
    }
}

export class Range {
    public readonly start: Position;
    public readonly end: Position;

    public constructor(start: Position, end: Position);
    public constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    public constructor(...args: [Position, Position] | [number, number, number, number]) {
        const [first, second] = args.length === 2 ? args : [new Position(args[0], args[1]), new Position(args[2], args[3])];
        [this.start, this.end] = first.isAfter(second) ? [second, first] : [first, second];
    }

    public get isEmpty(): boolean {
        return this.start.isEqual(this.end);
    }

    public contains(positionOrRange: Position | Range): boolean {
        if (positionOrRange instanceof Range) {
            return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
        }
        return !positionOrRange.isBefore(this.start) && !positionOrRange.isAfter(this.end);
    }
}

export class Selection extends Range {
    public readonly anchor: Position;
    public readonly active: Position;

    public constructor(anchor: Position, active: Position) {
        super(anchor, active);
        this.anchor = anchor;
        this.active = active;
    }
}

export interface TextDocumentContentChange {
    readonly range: Range;
    readonly rangeOffset: number;
    readonly rangeLength: number;
    readonly text: string;
}

export interface TextDocumentChangeEvent {
    readonly document: FakeTextDocument;
    readonly contentChanges: readonly TextDocumentContentChange[];
    readonly reason: undefined;
}

export interface DocumentOptions {
    readonly languageId?: string;
    readonly version?: number;
    readonly isDirty?: boolean;
}

const LANGUAGES: Readonly<Record<string, string>> = {
    '.ts': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'javascriptreact',
    '.vue': 'vue',
    '.json': 'json',
    '.css': 'css',
};

const opened = hostEvent<FakeTextDocument>('workspace.onDidOpenTextDocument');
const closed = hostEvent<FakeTextDocument>('workspace.onDidCloseTextDocument');
const changed = hostEvent<TextDocumentChangeEvent>('workspace.onDidChangeTextDocument');
const saved = hostEvent<FakeTextDocument>('workspace.onDidSaveTextDocument');
let openDocuments: FakeTextDocument[] = [];

function languageOf(path: string): string {
    const extension = /\.[^./]+$/.exec(path)?.[0].toLowerCase() ?? '';
    return LANGUAGES[extension] ?? 'plaintext';
}

export class FakeTextDocument {
    public readonly uri: Uri;
    public readonly fileName: string;
    public readonly languageId: string;
    public version: number;
    public isDirty: boolean;
    public isClosed = false;
    private text: string;

    public constructor(path: string | Uri, text: string, options: DocumentOptions = {}) {
        this.uri = typeof path === 'string' ? Uri.file(path) : path;
        this.fileName = this.uri.fsPath;
        this.languageId = options.languageId ?? languageOf(this.uri.path);
        this.version = options.version ?? 1;
        this.isDirty = options.isDirty ?? false;
        this.text = text;
    }

    public get lineCount(): number {
        return this.lineStarts().length;
    }

    public getText(): string {
        return this.text;
    }

    public positionAt(offset: number): Position {
        const clamped = Math.max(0, Math.min(Math.floor(offset), this.text.length));
        const starts = this.lineStarts();
        let line = 0;
        while (line + 1 < starts.length && starts[line + 1]! <= clamped) {
            line++;
        }
        return new Position(line, clamped - starts[line]!);
    }

    public offsetAt(position: Position): number {
        const starts = this.lineStarts();
        const line = Math.max(0, Math.min(position.line, starts.length - 1));
        const start = starts[line]!;
        const end = line + 1 < starts.length ? starts[line + 1]! - 1 : this.text.length;
        return start + Math.max(0, Math.min(position.character, end - start));
    }

    public edit(text: string): void {
        const range = new Range(new Position(0, 0), this.positionAt(this.text.length));
        const rangeLength = this.text.length;
        this.text = text;
        this.version++;
        this.isDirty = true;
        changed.fire({ document: this, contentChanges: [{ range, rangeOffset: 0, rangeLength, text }], reason: undefined });
    }

    public save(): void {
        setVirtualFile(this.uri.path, this.text);
        this.isDirty = false;
        saved.fire(this);
    }

    private lineStarts(): number[] {
        const starts = [0];
        for (let index = 0; index < this.text.length; index++) {
            if (this.text.charCodeAt(index) === 10) {
                starts.push(index + 1);
            }
        }
        return starts;
    }
}

export function textDocuments(): readonly FakeTextDocument[] {
    return openDocuments;
}

export function openDocument(path: string | Uri, text: string, options: DocumentOptions = {}): FakeTextDocument {
    const document = new FakeTextDocument(path, text, options);
    openDocuments = [...openDocuments, document];
    opened.fire(document);
    return document;
}

export function closeDocument(document: FakeTextDocument): void {
    openDocuments = openDocuments.filter(open => open !== document);
    document.isClosed = true;
    closed.fire(document);
}

export function onDidOpenTextDocument(listener: (document: FakeTextDocument) => unknown): Disposable {
    return opened.add(listener);
}

export function onDidCloseTextDocument(listener: (document: FakeTextDocument) => unknown): Disposable {
    return closed.add(listener);
}

export function onDidChangeTextDocument(listener: (event: TextDocumentChangeEvent) => unknown): Disposable {
    return changed.add(listener);
}

export function onDidSaveTextDocument(listener: (document: FakeTextDocument) => unknown): Disposable {
    return saved.add(listener);
}

export function resetDocuments(): void {
    openDocuments = [];
}
