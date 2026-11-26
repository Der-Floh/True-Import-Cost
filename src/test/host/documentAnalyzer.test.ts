import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { DocumentAnalyzer } from '../../extension/services/documentAnalyzer';
import { readSettings } from '../../extension/services/settings';
import { closeDocument, hostListenerCounts, openDocument } from '../__mocks__/vscode';
import { cancellationToken, preloadParser, textDocument } from './support/extension';
import { lines } from './support/workspace';

import type { Settings } from '../../extension/services/settings';
import type { DocumentAnalysis } from '../../parser';
import type { FakeTextDocument } from '../__mocks__/vscode';

const SOURCE = lines("import { chunk } from 'lodash';", "import type { Options } from './options';", 'chunk([], 1);');

let settings: Settings;
let analyzer: DocumentAnalyzer;

function analyze(document: FakeTextDocument, token = cancellationToken()): Promise<DocumentAnalysis | undefined> {
    return analyzer.analyze(textDocument(document), token);
}

function specifiers(analysis: DocumentAnalysis | undefined): string[] | undefined {
    return analysis?.imports.map(each => each.specifier);
}

beforeAll(preloadParser);

beforeEach(() => {
    settings = readSettings();
    analyzer = new DocumentAnalyzer(() => settings);
});

afterEach(() => {
    analyzer.dispose();
});

describe('DocumentAnalyzer', () => {
    it('finds the imports of a document with the real parser', async () => {
        const analysis = await analyze(openDocument('/w/src/main.ts', SOURCE));

        expect(analysis?.imports.map(({ specifier, kind, typeOnly, hasValueUsage }) => ({ specifier, kind, typeOnly, hasValueUsage }))).toEqual([
            { specifier: 'lodash', kind: 'named', typeOnly: false, hasValueUsage: true },
            { specifier: './options', kind: 'named', typeOnly: true, hasValueUsage: false },
        ]);
        expect(analysis?.usageAnalysed).toBe(true);
    });

    it('reuses the analysis of a version it has seen', async () => {
        const document = openDocument('/w/src/main.ts', SOURCE);

        expect(await analyze(document)).toBe(await analyze(document));
    });

    it('does not wait to analyse a document that has not changed', async () => {
        vi.useFakeTimers();
        let analysis: DocumentAnalysis | undefined;

        void analyze(openDocument('/w/src/main.ts', SOURCE)).then((result) => {
            analysis = result;
        });
        await vi.advanceTimersByTimeAsync(0);

        expect(specifiers(analysis)).toEqual(['lodash', './options']);
    });

    it('waits until an edited document has been still for the debounce', async () => {
        vi.useFakeTimers();
        const document = openDocument('/w/src/main.ts', SOURCE);
        await analyze(document);
        let analysis: DocumentAnalysis | undefined;

        document.edit(lines("import { debounce } from 'lodash-es';", 'debounce(() => undefined, 10);'));
        void analyze(document).then((result) => {
            analysis = result;
        });
        await vi.advanceTimersByTimeAsync(299);
        expect(analysis).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);

        expect(specifiers(analysis)).toEqual(['lodash-es']);
    });

    it('gives up when the request is cancelled while it waits', async () => {
        vi.useFakeTimers();
        const document = openDocument('/w/src/main.ts', SOURCE);
        document.edit(lines("import { debounce } from 'lodash-es';"));
        const source = new vscode.CancellationTokenSource();

        const pending = analyze(document, source.token);
        await vi.advanceTimersByTimeAsync(100);
        source.cancel();

        expect(await pending).toBeUndefined();
    });

    it('analyses again when usage analysis is turned off', async () => {
        const document = openDocument('/w/src/main.ts', SOURCE);
        const withUsage = await analyze(document);

        settings = { ...settings, usageAnalysis: false };
        const withoutUsage = await analyze(document);

        expect([withUsage?.usageAnalysed, withoutUsage?.usageAnalysed]).toEqual([true, false]);
        expect(withoutUsage?.imports[0]?.hasValueUsage).toBeUndefined();
    });

    it('forgets a document once it is closed', async () => {
        const document = openDocument('/w/src/main.ts', SOURCE);
        const first = await analyze(document);

        closeDocument(document);

        expect(await analyze(document)).not.toBe(first);
    });

    it('forgets every document when cleared', async () => {
        const document = openDocument('/w/src/main.ts', SOURCE);
        const first = await analyze(document);

        analyzer.clear();

        expect(await analyze(document)).not.toBe(first);
    });

    it('skips a document too large to analyse', async () => {
        const document = openDocument('/w/src/generated.ts', `import { x } from 'x';\n${'// filler\n'.repeat(200_001)}`);

        expect(await analyze(document)).toEqual({ imports: [], usageAnalysed: false });
    });

    it('stops listening for document events once disposed', () => {
        expect(hostListenerCounts()).toEqual({ 'workspace.onDidChangeTextDocument': 1, 'workspace.onDidCloseTextDocument': 1 });

        analyzer.dispose();

        expect(hostListenerCounts()).toEqual({});
    });
});
