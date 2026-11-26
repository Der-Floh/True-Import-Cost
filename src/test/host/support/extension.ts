import { expect, vi } from 'vitest';
import * as vscode from 'vscode';

import { activate } from '../../../extension/extension';
import { loadParser } from '../../../extension/services/parserHost';
import { createExtensionContext, diagnosticCollections, matchesSelector, registeredProviders, statusBarItems, treeViews } from '../../__mocks__/vscode';

import type { FakeTextDocument, ProviderKind } from '../../__mocks__/vscode';

export interface ActiveExtension {
    readonly context: vscode.ExtensionContext;
    deactivate(): void;
}

export interface TreeEntry<T> {
    readonly node: T;
    readonly item: vscode.TreeItem;
}

export async function settle(): Promise<void> {
    for (let turn = 0; turn < 3; turn++) {
        if (vi.isFakeTimers()) {
            await vi.advanceTimersByTimeAsync(0);
        } else {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
}

export async function preloadParser(): Promise<void> {
    await loadParser();
}

export function nextEvent<T>(event: vscode.Event<T>): Promise<T> {
    return new Promise((resolve) => {
        const subscription = event((value) => {
            subscription.dispose();
            resolve(value);
        });
    });
}

export async function activateExtension(): Promise<ActiveExtension> {
    const context = createExtensionContext();
    activate(context);
    await settle();
    return {
        context,
        deactivate: () => {
            for (const subscription of context.subscriptions.splice(0)) {
                subscription.dispose();
            }
        },
    };
}

export function textDocument(document: FakeTextDocument): vscode.TextDocument {
    return document as unknown as vscode.TextDocument;
}

export function cancellationToken(): vscode.CancellationToken {
    return new vscode.CancellationTokenSource().token;
}

export function offsetOf(document: FakeTextDocument, needle: string): number {
    const offset = document.getText().indexOf(needle);
    expect(offset, `"${needle}" is in the document`).toBeGreaterThanOrEqual(0);
    return offset;
}

function providerFor<T>(kind: ProviderKind, document: FakeTextDocument): T | undefined {
    const matching = registeredProviders(kind).filter(registration => matchesSelector(registration.selector, document));
    expect(matching.length).toBeLessThanOrEqual(1);
    return matching[0]?.provider as T | undefined;
}

export async function inlayHints(document: FakeTextDocument): Promise<vscode.InlayHint[]> {
    const provider = providerFor<vscode.InlayHintsProvider>('inlayHints', document);
    const hints = await provider?.provideInlayHints(textDocument(document), new vscode.Range(0, 0, document.lineCount, 0), cancellationToken());
    return hints ?? [];
}

export function hintLabel(hint: vscode.InlayHint): string {
    return typeof hint.label === 'string' ? hint.label : hint.label.map(part => part.value).join('');
}

export async function inlineCosts(document: FakeTextDocument): Promise<[string, string][]> {
    const text = document.getText().split('\n');
    return (await inlayHints(document)).map(hint => [text[hint.position.line]!.slice(0, hint.position.character).trim(), hintLabel(hint)]);
}

export async function hoverAt(document: FakeTextDocument, needle: string): Promise<vscode.Hover | undefined> {
    const provider = providerFor<vscode.HoverProvider>('hover', document);
    const position = document.positionAt(offsetOf(document, needle)) as unknown as vscode.Position;
    const hover = await provider?.provideHover(textDocument(document), position, cancellationToken());
    return hover ?? undefined;
}

export function markdownOf(hover: vscode.Hover | undefined): vscode.MarkdownString {
    const [content] = hover?.contents ?? [];
    expect(content).toBeInstanceOf(vscode.MarkdownString);
    return content as vscode.MarkdownString;
}

export function liveCommandLinks(markdown: string): string[] {
    const outsideCode = markdown.replace(/\\./g, '').replace(/`[^`]*`/g, '');
    return [...outsideCode.matchAll(/\]\(command:([^?)\s]+)/g)].map(match => match[1]!);
}

export function commandLinkArguments(markdown: string, command: string): unknown[] {
    const opening = `](command:${command}?`;
    const start = markdown.indexOf(opening);
    expect(start, `a link to ${command}`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = start + opening.length;
    for (; end < markdown.length; end++) {
        const character = markdown.charAt(end);
        if (character === '(') {
            depth++;
        } else if (character === ')' && depth-- === 0) {
            break;
        }
    }
    return JSON.parse(decodeURIComponent(markdown.slice(start + opening.length, end))) as unknown[];
}

export function diagnosticsOf(document: FakeTextDocument): readonly vscode.Diagnostic[] {
    const collection = diagnosticCollections().find(each => each.name === 'trueImportCost' && !each.disposed);
    return (collection?.get(document.uri) ?? []) as unknown as readonly vscode.Diagnostic[];
}

export async function codeActionsFor(document: FakeTextDocument, diagnostics: readonly vscode.Diagnostic[]): Promise<vscode.CodeAction[]> {
    const provider = providerFor<vscode.CodeActionProvider>('codeActions', document);
    const range = diagnostics[0]?.range ?? new vscode.Range(0, 0, 0, 0);
    const actions = await provider?.provideCodeActions(textDocument(document), range, { diagnostics, only: undefined, triggerKind: 1 }, cancellationToken());
    return (actions ?? []).filter((action): action is vscode.CodeAction => action instanceof vscode.CodeAction);
}

export function statusBar(): ReturnType<typeof statusBarItems>[number] {
    const item = statusBarItems().find(each => each.id === 'trueImportCost.target' && !each.disposed);
    expect(item, 'the status bar item').toBeDefined();
    return item!;
}

export function treeProvider<T>(id: string): vscode.TreeDataProvider<T> {
    const view = treeViews().find(each => each.id === id && !each.disposed);
    expect(view, `the ${id} view`).toBeDefined();
    return view!.treeDataProvider as vscode.TreeDataProvider<T>;
}

export async function treeChildren<T>(provider: vscode.TreeDataProvider<T>, node?: T): Promise<TreeEntry<T>[]> {
    const children = await provider.getChildren(node) ?? [];
    const entries: TreeEntry<T>[] = [];
    for (const child of children) {
        entries.push({ node: child, item: await provider.getTreeItem(child) });
    }
    return entries;
}
