import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { changeSetting, closeDocument, openDocument, registeredProviders, setWorkspaceFolders } from '../__mocks__/vscode';
import { activateExtension, codeActionsFor, diagnosticsOf, preloadParser, settle } from './support/extension';
import { DUPLICATE_KEY, DUPLICATE_METADATA, DUPLICATE_SOURCE, writeDuplicatedLodash } from './support/fixtures';
import { esbuildMetafile, staticImport } from './support/metafile';
import { lines, writeJson } from './support/workspace';

import type { FakeTextDocument } from '../__mocks__/vscode';
import type { ActiveExtension } from './support/extension';

const MESSAGE = 'lodash is bundled 2 times in "app": 4.17.21 (70 kB), 3.10.1 (60 kB). Together 130 kB.';

let extension: ActiveExtension | undefined;
let document: FakeTextDocument;

async function activated(): Promise<void> {
    extension = await activateExtension();
}

beforeAll(preloadParser);

beforeEach(() => {
    setWorkspaceFolders('/w');
});

afterEach(() => {
    extension?.deactivate();
    extension = undefined;
});

describe('duplicate package diagnostics', () => {
    beforeEach(async () => {
        document = writeDuplicatedLodash();
        await activated();
    });

    it('mark the import of a package the build bundles more than once', () => {
        const diagnostics = diagnosticsOf(document);

        expect(diagnostics.map(({ message, severity, source, code, range }) => ({ message, severity, source, code, range }))).toEqual([{
            message: MESSAGE,
            severity: vscode.DiagnosticSeverity.Information,
            source: 'True Import Cost',
            code: 'duplicate-package',
            range: new vscode.Range(0, 22, 0, 30),
        }]);
    });

    it('follow an edit that removes the import', async () => {
        changeSetting('trueImportCost.analysis.debounceMs', 0);

        document.edit(lines("import { renderWidget } from 'legacy-widget';", 'renderWidget([]);'));
        await settle();

        expect(diagnosticsOf(document)).toEqual([]);
    });

    it('are removed when the document is closed', () => {
        closeDocument(document);

        expect(diagnosticsOf(document)).toEqual([]);
    });

    it('are removed when diagnostics.duplicatePackages is turned off', async () => {
        changeSetting('trueImportCost.diagnostics.duplicatePackages', false);
        await settle();

        expect(diagnosticsOf(document)).toEqual([]);
    });

    it('are removed when the extension is turned off', async () => {
        changeSetting('trueImportCost.enabled', false);
        await settle();

        expect(diagnosticsOf(document)).toEqual([]);
    });

    it('go away when a rebuild bundles the package only once', async () => {
        writeJson(DUPLICATE_METADATA, esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 400, imports: [staticImport('lodash', 'node_modules/lodash/lodash.js'), staticImport('legacy-widget', 'node_modules/legacy-widget/index.js')] },
                'node_modules/lodash/lodash.js': { output: 70_000 },
                'node_modules/legacy-widget/index.js': { output: 5_000, imports: [staticImport('lodash', 'node_modules/lodash/lodash.js')] },
            },
        }));

        await vscode.commands.executeCommand('trueImportCost.refresh');
        await settle();

        expect(diagnosticsOf(document)).toEqual([]);
    });

    it('offer a quick fix that explains why the package is bundled twice', async () => {
        const diagnostics = diagnosticsOf(document);

        const actions = await codeActionsFor(document, diagnostics);

        expect(actions.map(({ title, kind, command, diagnostics: fixed }) => ({ title, kind, command, fixed }))).toEqual([{
            title: 'Explain why lodash is bundled 2 times',
            kind: vscode.CodeActionKind.QuickFix,
            command: {
                title: 'Explain why lodash is bundled 2 times',
                command: 'trueImportCost.explainWhyIncluded',
                arguments: [{ target: DUPLICATE_KEY, packageName: 'lodash', label: 'lodash' }],
            },
            fixed: [diagnostics[0]],
        }]);
    });

    it('offer no quick fix for diagnostics of others', async () => {
        const foreign = new vscode.Diagnostic(new vscode.Range(0, 22, 0, 30), 'Unexpected import', vscode.DiagnosticSeverity.Warning);
        foreign.code = 'no-restricted-imports';

        expect(await codeActionsFor(document, [foreign])).toEqual([]);
    });

    it('declare quick fixes as the code actions they provide', () => {
        expect(registeredProviders('codeActions')[0]?.metadata).toEqual({ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] });
    });
});

describe('duplicate package diagnostics of a document opened later', () => {
    it('appear once the document is opened', async () => {
        closeDocument(writeDuplicatedLodash());
        await activated();

        const opened = openDocument('/w/src/main.ts', DUPLICATE_SOURCE);
        await settle();

        expect(diagnosticsOf(opened).map(diagnostic => diagnostic.message)).toEqual([MESSAGE]);
    });
});
