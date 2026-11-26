import { hostEvent } from './events';
import { FakeTextDocument, openDocument, Position, Selection, textDocuments } from './documents';
import { readVirtualFile } from './fileSystem';
import { type Uri } from './uri';
import { createWebviewPanel } from './webview';

import type { MarkdownString } from './content';
import type { Disposable } from './events';
import type { Range } from './documents';

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

export const QuickPickItemKind = { Separator: -1, Default: 0 } as const;

export interface QuickPickItemLike {
    readonly label: string;
    readonly kind?: number;
    readonly description?: string;
    readonly detail?: string;
    readonly picked?: boolean;
}

export interface QuickPickRecord {
    readonly items: readonly QuickPickItemLike[];
    readonly options: Readonly<Record<string, unknown>> | undefined;
}

export interface InputBoxOptions {
    readonly title?: string;
    readonly prompt?: string;
    readonly value?: string;
    readonly validateInput?: (value: string) => string | undefined | null | PromiseLike<string | undefined | null>;
}

export class FakeTextEditor {
    public readonly document: FakeTextDocument;
    public selection: Selection;

    public constructor(document: FakeTextDocument, selection: Selection) {
        this.document = document;
        this.selection = selection;
    }
}

class FakeLogOutputChannel {
    public readonly name: string;
    public readonly lines: string[] = [];
    public shown = 0;
    public disposed = false;

    public constructor(name: string) {
        this.name = name;
    }

    public trace(message: string): void {
        this.lines.push(`trace ${message}`);
    }

    public debug(message: string): void {
        this.lines.push(`debug ${message}`);
    }

    public info(message: string): void {
        this.lines.push(`info ${message}`);
    }

    public warn(message: string): void {
        this.lines.push(`warn ${message}`);
    }

    public error(message: string): void {
        this.lines.push(`error ${message}`);
    }

    public show(): void {
        this.shown++;
    }

    public dispose(): void {
        this.disposed = true;
    }
}

class FakeStatusBarItem {
    public readonly id: string;
    public readonly alignment: number | undefined;
    public readonly priority: number | undefined;
    public name: string | undefined;
    public text = '';
    public tooltip: string | MarkdownString | undefined;
    public command: string | undefined;
    public visible = false;
    public disposed = false;

    public constructor(id: string, alignment: number | undefined, priority: number | undefined) {
        this.id = id;
        this.alignment = alignment;
        this.priority = priority;
    }

    public show(): void {
        this.visible = true;
    }

    public hide(): void {
        this.visible = false;
    }

    public dispose(): void {
        this.visible = false;
        this.disposed = true;
    }
}

class FakeTreeView {
    public readonly id: string;
    public readonly treeDataProvider: unknown;
    public readonly showCollapseAll: boolean | undefined;
    public description: string | undefined;
    public refreshes = 0;
    public disposed = false;
    private readonly subscription: { dispose(): unknown } | undefined;

    public constructor(id: string, options: { readonly treeDataProvider: unknown; readonly showCollapseAll?: boolean }) {
        this.id = id;
        this.treeDataProvider = options.treeDataProvider;
        this.showCollapseAll = options.showCollapseAll;
        const onDidChange = (options.treeDataProvider as { onDidChangeTreeData?: unknown }).onDidChangeTreeData;
        this.subscription = typeof onDidChange === 'function'
            ? (onDidChange as (listener: () => void) => { dispose(): unknown })(() => {
                this.refreshes++;
            })
            : undefined;
    }

    public dispose(): void {
        this.subscription?.dispose();
        this.disposed = true;
    }
}

const activeEditorChanged = hostEvent<FakeTextEditor | undefined>('window.onDidChangeActiveTextEditor');
let activeEditor: FakeTextEditor | undefined;
let channels: FakeLogOutputChannel[] = [];
let statusItems: FakeStatusBarItem[] = [];
let views: FakeTreeView[] = [];
let informationMessages: string[] = [];
let warningMessages: string[] = [];
let errorMessages: string[] = [];
let quickPicks: QuickPickRecord[] = [];
let quickPickChoice: ((item: QuickPickItemLike) => boolean) | undefined;
let inputBoxes: InputBoxOptions[] = [];
let inputBoxAnswer: string | undefined;
let openDialogs: Readonly<Record<string, unknown>>[] = [];
let openDialogAnswer: Uri[] | undefined;
let warningAnswer: string | undefined;
let shownDocuments: { readonly path: string; readonly selection?: Range }[] = [];

function documentFor(target: Uri | FakeTextDocument): FakeTextDocument {
    if (target instanceof FakeTextDocument) {
        return target;
    }
    const open = textDocuments().find(document => document.uri.toString() === target.toString());
    return open ?? openDocument(target, readVirtualFile(target.path) ?? '');
}

export const window = {
    get activeTextEditor(): FakeTextEditor | undefined {
        return activeEditor;
    },
    onDidChangeActiveTextEditor: (listener: (editor: FakeTextEditor | undefined) => unknown): Disposable => activeEditorChanged.add(listener),
    createOutputChannel: (name: string, _options: { readonly log: true }): FakeLogOutputChannel => {
        const channel = new FakeLogOutputChannel(name);
        channels.push(channel);
        return channel;
    },
    createStatusBarItem: (id: string, alignment?: number, priority?: number): FakeStatusBarItem => {
        const item = new FakeStatusBarItem(id, alignment, priority);
        statusItems.push(item);
        return item;
    },
    createTreeView: (id: string, options: { readonly treeDataProvider: unknown; readonly showCollapseAll?: boolean }): FakeTreeView => {
        const view = new FakeTreeView(id, options);
        views.push(view);
        return view;
    },
    showInformationMessage: (message: string): Promise<undefined> => {
        informationMessages.push(message);
        return Promise.resolve(undefined);
    },
    showWarningMessage: (message: string, ...rest: unknown[]): Promise<string | undefined> => {
        warningMessages.push(message);
        return Promise.resolve(rest.includes(warningAnswer) ? warningAnswer : undefined);
    },
    showErrorMessage: (message: string): Promise<undefined> => {
        errorMessages.push(message);
        return Promise.resolve(undefined);
    },
    showQuickPick: <T extends QuickPickItemLike>(items: readonly T[], options?: Readonly<Record<string, unknown>>): Promise<T | undefined> => {
        quickPicks.push({ items, options });
        const choose = quickPickChoice;
        const picked = choose === undefined ? undefined : items.find(item => item.kind !== QuickPickItemKind.Separator && choose(item));
        return Promise.resolve(picked);
    },
    showInputBox: (options: InputBoxOptions): Promise<string | undefined> => {
        inputBoxes.push(options);
        return Promise.resolve(inputBoxAnswer);
    },
    showOpenDialog: (options: Readonly<Record<string, unknown>>): Promise<Uri[] | undefined> => {
        openDialogs.push(options);
        return Promise.resolve(openDialogAnswer);
    },
    showTextDocument: (target: Uri | FakeTextDocument, options: { readonly selection?: Range } = {}): Promise<FakeTextEditor> => {
        const document = documentFor(target);
        shownDocuments.push({ path: document.uri.path, ...(options.selection === undefined ? {} : { selection: options.selection }) });
        const start = options.selection?.start ?? new Position(0, 0);
        activeEditor = new FakeTextEditor(document, new Selection(start, options.selection?.end ?? start));
        activeEditorChanged.fire(activeEditor);
        return Promise.resolve(activeEditor);
    },
    createWebviewPanel,
};

export function openTextDocument(target: Uri): Promise<FakeTextDocument> {
    return Promise.resolve(documentFor(target));
}

export function setWarningMessageAnswer(answer: string | undefined): void {
    warningAnswer = answer;
}

export function flushShownDocuments(): { readonly path: string; readonly selection?: Range }[] {
    return shownDocuments.splice(0);
}

export function setActiveTextEditor(document: FakeTextDocument | undefined, cursor: number | Position = 0): FakeTextEditor | undefined {
    if (document === undefined) {
        activeEditor = undefined;
    } else {
        const position = typeof cursor === 'number' ? document.positionAt(cursor) : new Position(cursor.line, cursor.character);
        activeEditor = new FakeTextEditor(document, new Selection(position, position));
    }
    activeEditorChanged.fire(activeEditor);
    return activeEditor;
}

export function setQuickPickChoice(choose: ((item: QuickPickItemLike) => boolean) | undefined): void {
    quickPickChoice = choose;
}

export function setInputBoxAnswer(answer: string | undefined): void {
    inputBoxAnswer = answer;
}

export function setOpenDialogAnswer(answer: Uri[] | undefined): void {
    openDialogAnswer = answer;
}

export function flushInformationMessages(): string[] {
    return informationMessages.splice(0);
}

export function flushWarningMessages(): string[] {
    return warningMessages.splice(0);
}

export function flushErrorMessages(): string[] {
    return errorMessages.splice(0);
}

export function flushQuickPicks(): QuickPickRecord[] {
    return quickPicks.splice(0);
}

export function flushInputBoxes(): InputBoxOptions[] {
    return inputBoxes.splice(0);
}

export function flushOpenDialogs(): Readonly<Record<string, unknown>>[] {
    return openDialogs.splice(0);
}

export function flushLogs(): string[] {
    return channels.flatMap(channel => channel.lines.splice(0));
}

export function outputChannels(): readonly FakeLogOutputChannel[] {
    return channels;
}

export function statusBarItems(): readonly FakeStatusBarItem[] {
    return statusItems;
}

export function treeViews(): readonly FakeTreeView[] {
    return views;
}

export function resetWindow(): void {
    activeEditor = undefined;
    channels = [];
    statusItems = [];
    views = [];
    informationMessages = [];
    warningMessages = [];
    errorMessages = [];
    quickPicks = [];
    quickPickChoice = undefined;
    inputBoxes = [];
    inputBoxAnswer = undefined;
    openDialogs = [];
    openDialogAnswer = undefined;
    warningAnswer = undefined;
    shownDocuments = [];
}
