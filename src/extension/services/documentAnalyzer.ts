import * as vscode from 'vscode';

import { Logger } from './logger';
import { loadParser } from './parserHost';

import type { Settings } from './settings';
import type { DocumentAnalysis } from '../../parser';

interface CachedAnalysis {
    readonly version: number;
    readonly usage: boolean;
    readonly analysis: Promise<DocumentAnalysis>;
}

export const MAX_DOCUMENT_LENGTH = 2_000_000;

const EMPTY: DocumentAnalysis = { imports: [], usageAnalysed: false };

function wait(milliseconds: number, token: vscode.CancellationToken): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            listener.dispose();
            resolve(true);
        }, milliseconds);
        const listener = token.onCancellationRequested(() => {
            clearTimeout(timer);
            listener.dispose();
            resolve(false);
        });
    });
}

function parse(languageId: string, fileName: string, text: string, usage: boolean): Promise<DocumentAnalysis> {
    return loadParser()
        .then(parser => parser.analyzeDocument(languageId, fileName, text, { usage }))
        .catch((error: unknown) => {
            Logger.error(`Analysing ${fileName} failed: ${error instanceof Error ? error.message : String(error)}`);
            return EMPTY;
        });
}

export class DocumentAnalyzer implements vscode.Disposable {
    private readonly settings: () => Settings;
    private readonly cache = new Map<string, CachedAnalysis>();
    private readonly lastChange = new Map<string, number>();
    private readonly subscriptions: vscode.Disposable[];

    public constructor(settings: () => Settings) {
        this.settings = settings;
        this.subscriptions = [
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.contentChanges.length > 0) {
                    this.lastChange.set(event.document.uri.toString(), Date.now());
                }
            }),
            vscode.workspace.onDidCloseTextDocument((document) => {
                const key = document.uri.toString();
                this.cache.delete(key);
                this.lastChange.delete(key);
            }),
        ];
    }

    public async analyze(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<DocumentAnalysis | undefined> {
        const settings = this.settings();
        const key = document.uri.toString();
        const cached = this.cache.get(key);
        if (cached?.version === document.version && cached.usage === settings.usageAnalysis) {
            return cached.analysis;
        }

        const elapsed = Date.now() - (this.lastChange.get(key) ?? 0);
        if (elapsed < settings.debounceMs && !(await wait(settings.debounceMs - elapsed, token))) {
            return undefined;
        }
        if (token.isCancellationRequested) {
            return undefined;
        }

        const again = this.cache.get(key);
        if (again?.version === document.version && again.usage === settings.usageAnalysis) {
            return again.analysis;
        }

        const text = document.getText();
        if (text.length > MAX_DOCUMENT_LENGTH) {
            return EMPTY;
        }
        const analysis = parse(document.languageId, document.fileName, text, settings.usageAnalysis);
        this.cache.set(key, { version: document.version, usage: settings.usageAnalysis, analysis });
        return analysis;
    }

    public importsIn(fileName: string, text: string): Promise<DocumentAnalysis> {
        return text.length > MAX_DOCUMENT_LENGTH ? Promise.resolve(EMPTY) : parse('', fileName, text, false);
    }

    public clear(): void {
        this.cache.clear();
    }

    public dispose(): void {
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.cache.clear();
    }
}
