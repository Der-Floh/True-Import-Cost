import { Disposable } from './events';

import type { Command, MarkdownString } from './content';
import type { Position, Range } from './documents';
import type { Uri } from './uri';

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

export class Diagnostic {
    public range: Range;
    public message: string;
    public severity: number;
    public source: string | undefined;
    public code: string | number | undefined;

    public constructor(range: Range, message: string, severity: number = DiagnosticSeverity.Error) {
        this.range = range;
        this.message = message;
        this.severity = severity;
    }
}

export class CodeActionKind {
    public static readonly QuickFix = new CodeActionKind('quickfix');

    public readonly value: string;

    private constructor(value: string) {
        this.value = value;
    }
}

export class CodeAction {
    public title: string;
    public kind: CodeActionKind | undefined;
    public command: Command | undefined;
    public diagnostics: Diagnostic[] | undefined;

    public constructor(title: string, kind?: CodeActionKind) {
        this.title = title;
        this.kind = kind;
    }
}

export class InlayHintLabelPart {
    public value: string;
    public tooltip: string | MarkdownString | undefined;
    public command: Command | undefined;

    public constructor(value: string) {
        this.value = value;
    }
}

export class InlayHint {
    public position: Position;
    public label: string | InlayHintLabelPart[];
    public kind: number | undefined;
    public tooltip: string | MarkdownString | undefined;
    public paddingLeft: boolean | undefined;
    public paddingRight: boolean | undefined;

    public constructor(position: Position, label: string | InlayHintLabelPart[], kind?: number) {
        this.position = position;
        this.label = label;
        this.kind = kind;
    }
}

export class Hover {
    public contents: (MarkdownString | string)[];
    public range: Range | undefined;

    public constructor(contents: MarkdownString | string | (MarkdownString | string)[], range?: Range) {
        this.contents = Array.isArray(contents) ? contents : [contents];
        this.range = range;
    }
}

export type ProviderKind = 'inlayHints' | 'hover' | 'codeActions';

export interface ProviderRegistration {
    readonly kind: ProviderKind;
    readonly selector: unknown;
    readonly provider: unknown;
    readonly metadata: unknown;
    readonly changes: number;
}

interface MutableRegistration extends ProviderRegistration {
    changes: number;
}

class FakeDiagnosticCollection {
    public readonly name: string;
    public disposed = false;
    private readonly entries = new Map<string, { readonly uri: Uri; readonly diagnostics: readonly Diagnostic[] }>();

    public constructor(name: string) {
        this.name = name;
    }

    public set(uri: Uri, diagnostics: readonly Diagnostic[] | undefined): void {
        this.checkDisposed();
        if (diagnostics === undefined) {
            this.entries.delete(uri.toString());
        } else {
            this.entries.set(uri.toString(), { uri, diagnostics: [...diagnostics] });
        }
    }

    public get(uri: Uri): readonly Diagnostic[] {
        this.checkDisposed();
        return this.entries.get(uri.toString())?.diagnostics ?? [];
    }

    public has(uri: Uri): boolean {
        this.checkDisposed();
        return this.entries.has(uri.toString());
    }

    public delete(uri: Uri): void {
        this.checkDisposed();
        this.entries.delete(uri.toString());
    }

    public clear(): void {
        this.checkDisposed();
        this.entries.clear();
    }

    public forEach(callback: (uri: Uri, diagnostics: readonly Diagnostic[]) => unknown): void {
        this.checkDisposed();
        for (const { uri, diagnostics } of this.entries.values()) {
            callback(uri, diagnostics);
        }
    }

    public dispose(): void {
        if (!this.disposed) {
            this.entries.clear();
            this.disposed = true;
        }
    }

    private checkDisposed(): void {
        if (this.disposed) {
            throw new Error('illegal state - object is disposed');
        }
    }
}

let registrations: MutableRegistration[] = [];
let collections: FakeDiagnosticCollection[] = [];

function register(kind: ProviderKind, selector: unknown, provider: unknown, metadata?: unknown): Disposable {
    const registration: MutableRegistration = { kind, selector, provider, metadata, changes: 0 };
    registrations.push(registration);
    const onDidChange = kind === 'inlayHints' ? (provider as { onDidChangeInlayHints?: unknown }).onDidChangeInlayHints : undefined;
    const subscription = typeof onDidChange === 'function'
        ? (onDidChange as (listener: () => void) => { dispose(): unknown })(() => {
            registration.changes++;
        })
        : undefined;
    return new Disposable(() => {
        registrations = registrations.filter(each => each !== registration);
        subscription?.dispose();
    });
}

export const languages = {
    registerInlayHintsProvider: (selector: unknown, provider: unknown): Disposable => register('inlayHints', selector, provider),
    registerHoverProvider: (selector: unknown, provider: unknown): Disposable => register('hover', selector, provider),
    registerCodeActionsProvider: (selector: unknown, provider: unknown, metadata?: unknown): Disposable =>
        register('codeActions', selector, provider, metadata),
    createDiagnosticCollection: (name: string): FakeDiagnosticCollection => {
        const collection = new FakeDiagnosticCollection(name);
        collections.push(collection);
        return collection;
    },
};

function matchesFilter(filter: unknown, document: { readonly languageId: string; readonly uri: Uri }): boolean {
    if (typeof filter === 'string') {
        return filter === '*' || filter === document.languageId;
    }
    const { language, scheme } = filter as { readonly language?: string; readonly scheme?: string };
    return (language === undefined || language === document.languageId) && (scheme === undefined || scheme === document.uri.scheme);
}

export function matchesSelector(selector: unknown, document: { readonly languageId: string; readonly uri: Uri }): boolean {
    return (Array.isArray(selector) ? selector : [selector]).some(filter => matchesFilter(filter, document));
}

export function registeredProviders(kind: ProviderKind): readonly ProviderRegistration[] {
    return registrations.filter(registration => registration.kind === kind);
}

export function diagnosticCollections(): readonly FakeDiagnosticCollection[] {
    return collections;
}

export function resetLanguages(): void {
    registrations = [];
    collections = [];
}
