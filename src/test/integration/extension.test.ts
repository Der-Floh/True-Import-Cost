import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'Florian-Noever.true-import-cost';
const POLL_MS = 200;
const WAIT_MS = 20_000;

function workspaceUri(...segments: string[]): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'no workspace folder is open');
    return vscode.Uri.joinPath(folder.uri, ...segments);
}

async function waitFor<T>(produce: () => Promise<T | undefined>, what: string): Promise<T> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
        const value = await produce();
        if (value !== undefined) {
            return value;
        }
        if (Date.now() > deadline) {
            assert.fail(`timed out waiting for ${what}`);
        }
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
}

function labelOf(hint: vscode.InlayHint): string {
    return typeof hint.label === 'string' ? hint.label : hint.label.map(part => part.value).join('');
}

function positionOf(document: vscode.TextDocument, text: string): vscode.Position {
    const offset = document.getText().indexOf(text);
    assert.ok(offset >= 0, `"${text}" is not in ${document.uri.toString()}`);
    return document.positionAt(offset + 1);
}

async function openExtensionSource(): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument(workspaceUri('src', 'extension.ts'));
    return vscode.window.showTextDocument(document);
}

suite('True Import Cost in VS Code', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    });

    test('registers every command it contributes', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, 'the extension is not installed in the test host');
        const contributed = (extension.packageJSON as { contributes: { commands: { command: string }[] } }).contributes.commands;
        const registered = await vscode.commands.getCommands(true);

        for (const { command } of contributed) {
            assert.ok(registered.includes(command), `${command} is not registered`);
        }
    });

    test('shows the measured cost of each import inline', async () => {
        const { document } = await openExtensionSource();
        const range = new vscode.Range(0, 0, document.lineCount, 0);

        const labels = await waitFor(async () => {
            const hints = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', document.uri, range);
            const found = hints.map(labelOf);
            return found.some(label => label.includes('bundled')) ? found : undefined;
        }, 'inlay hints');

        assert.ok(labels.includes('external'), `no external hint in ${JSON.stringify(labels)}`);
        assert.ok(labels.some(label => label.endsWith('bundled · shared')), `no shared hint in ${JSON.stringify(labels)}`);
        assert.ok(labels.some(label => label.startsWith('0 B · unused')), `no unused hint in ${JSON.stringify(labels)}`);
    });

    test('explains an import in its hover', async () => {
        const { document } = await openExtensionSource();
        const position = positionOf(document, '\'big-library\'');

        const text = await waitFor(async () => {
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position);
            const contents = hovers.flatMap(hover => hover.contents.map(content => (typeof content === 'string' ? content : content.value))).join('\n');
            return contents.includes('Exclusive to this import') ? contents : undefined;
        }, 'the import hover');

        assert.match(text, /big-library/);
        assert.match(text, /3\\?\.2\\?\.0/);
    });

    test('reports a package that is bundled in two versions', async () => {
        const { document } = await openExtensionSource();

        const diagnostics = await waitFor(async () => {
            const found = vscode.languages.getDiagnostics(document.uri).filter(diagnostic => diagnostic.code === 'duplicate-package');
            return Promise.resolve(found.length > 0 ? found : undefined);
        }, 'the duplicate package diagnostic');

        assert.match(diagnostics[0]?.message ?? '', /dup-lib is bundled 2 times/);
    });

    test('explains why the import under the cursor is included', async () => {
        const editor = await openExtensionSource();
        const position = positionOf(editor.document, '\'big-library\'');
        editor.selection = new vscode.Selection(position, position);

        await vscode.commands.executeCommand('trueImportCost.explainWhyIncluded');
    });
});
