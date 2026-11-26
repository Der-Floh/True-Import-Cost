import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import {
    changeSetting,
    closeDocument,
    configurationChange,
    createExtensionContext,
    diagnosticCollections,
    emitterListenerCount,
    fireFileWatcher,
    flushConfigurationUpdates,
    flushExecutedCommands,
    flushFileReads,
    flushFileSearches,
    flushQuickPicks,
    holdFileRead,
    hostListenerCounts,
    openDocument,
    Position,
    registeredCommands,
    registeredProviders,
    setActiveTextEditor,
    setFileReadError,
    setQuickPickChoice,
    setSetting,
    setVirtualFile,
    setWorkspaceFolders,
    setWorkspaceTrusted,
    treeViews,
    watcherCount,
} from '../__mocks__/vscode';

describe('Uri', () => {
    it('joins paths and resolves dot segments as VS Code does', () => {
        const base = vscode.Uri.file('/w/app/.true-import-cost/meta.json');

        expect(vscode.Uri.joinPath(base, '..').path).toBe('/w/app/.true-import-cost');
        expect(vscode.Uri.joinPath(base, '..', '..', './src', 'a/../main.ts').path).toBe('/w/app/src/main.ts');
        expect(vscode.Uri.joinPath(vscode.Uri.file('/'), '..').path).toBe('/');
        expect(vscode.Uri.joinPath(vscode.Uri.file('/w'), '/abs').path).toBe('/w/abs');
    });

    it('encodes its string form and keeps the plain path in fsPath', () => {
        const uri = vscode.Uri.file('/w/my app/[x].json');

        expect(uri.toString()).toBe('file:///w/my%20app/%5Bx%5D.json');
        expect(uri.fsPath).toBe('/w/my app/[x].json');
        expect(uri.scheme).toBe('file');
        expect(uri.authority).toBe('');
    });

    it('reads Windows paths the same on every platform', () => {
        const uri = vscode.Uri.file('C:\\w\\meta.json');

        expect(uri.path).toBe('/C:/w/meta.json');
        expect(uri.fsPath).toBe('c:/w/meta.json');
        expect(uri.toString()).toBe('file:///c%3A/w/meta.json');
    });

    it('parses other schemes with their authority', () => {
        const uri = vscode.Uri.parse('vscode-remote://ssh-remote+box/w/src/main.ts');

        expect([uri.scheme, uri.authority, uri.path]).toEqual(['vscode-remote', 'ssh-remote+box', '/w/src/main.ts']);
        expect(vscode.Uri.parse('untitled:Untitled-1').path).toBe('Untitled-1');
    });
});

describe('workspace.fs', () => {
    it('serves virtual files with their size and time, and records reads', async () => {
        setVirtualFile('/w/a.json', '{"a":1}', { mtime: 1234 });

        const stat = await vscode.workspace.fs.stat(vscode.Uri.file('/w/a.json'));
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file('/w/a.json'));

        expect([stat.size, stat.mtime, stat.type]).toEqual([7, 1234, vscode.FileType.File]);
        expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
        expect(flushFileReads()).toEqual(['/w/a.json']);
    });

    it('rejects a missing file and a file that cannot be read', async () => {
        setVirtualFile('/w/locked.json', '{}');
        setFileReadError('/w/locked.json', new Error('EACCES: permission denied'));

        await expect(vscode.workspace.fs.stat(vscode.Uri.file('/w/missing.json'))).rejects.toThrow('EntryNotFound');
        await expect(vscode.workspace.fs.readFile(vscode.Uri.file('/w/locked.json'))).rejects.toThrow('EACCES');
        await expect(vscode.workspace.fs.stat(vscode.Uri.file('/w/locked.json'))).resolves.toMatchObject({ size: 2 });
    });

    it('holds a read until released, answering with the file as it was when the read began', async () => {
        setVirtualFile('/w/a.json', 'before');
        const release = holdFileRead('/w/a.json');
        let answer: string | undefined;
        const reading = vscode.workspace.fs.readFile(vscode.Uri.file('/w/a.json')).then((bytes) => {
            answer = new TextDecoder().decode(bytes);
        });

        setVirtualFile('/w/a.json', 'after');
        await Promise.resolve();
        expect(answer).toBeUndefined();
        release();
        await reading;

        expect(answer).toBe('before');
    });
});

describe('workspace.findFiles', () => {
    it('matches a relative pattern below its base, leaving out what the exclude glob matches', async () => {
        const [folder] = setWorkspaceFolders('/w');
        for (const path of ['/w/.true-import-cost/a.json', '/w/apps/web/.true-import-cost/b.json', '/w/.true-import-cost/nested/c.json', '/w/node_modules/x/.true-import-cost/d.json', '/other/.true-import-cost/e.json']) {
            setVirtualFile(path, '{}');
        }

        const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder!, '**/.true-import-cost/*.json'), '**/node_modules/**', 10);

        expect(found.map(uri => uri.path)).toEqual(['/w/.true-import-cost/a.json', '/w/apps/web/.true-import-cost/b.json']);
        expect(flushFileSearches()).toEqual([{ include: '/w/**/.true-import-cost/*.json', exclude: '**/node_modules/**', maxResults: 10 }]);
    });

    it('stops at the most results it was asked for', async () => {
        setWorkspaceFolders('/w');
        setVirtualFile('/w/a.json', '{}');
        setVirtualFile('/w/b.json', '{}');

        expect(await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file('/w'), '*.json'), undefined, 1)).toHaveLength(1);
    });

    it('reads braces and brackets in a glob as VS Code does', async () => {
        setVirtualFile('/w/meta1.json', '{}');
        setVirtualFile('/w/meta[1].json', '{}');
        setVirtualFile('/w/web.json', '{}');
        const find = async (glob: string): Promise<string[]> =>
            (await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file('/w'), glob))).map(uri => uri.path);

        expect(await find('{web,meta1}.json')).toEqual(['/w/meta1.json', '/w/web.json']);
        expect(await find('meta[1].json')).toEqual(['/w/meta1.json']);
        expect(await find('meta?.json')).toEqual(['/w/meta1.json']);
    });
});

describe('file system watchers', () => {
    it('tell only the listeners whose pattern selects the path, until disposed', () => {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file('/w'), '**/.true-import-cost/*.json'));
        const seen: string[] = [];
        watcher.onDidChange(uri => seen.push(`changed ${uri.path}`));
        watcher.onDidDelete(uri => seen.push(`deleted ${uri.path}`));

        fireFileWatcher('changed', '/w/.true-import-cost/a.json');
        fireFileWatcher('deleted', '/w/a/.true-import-cost/b.json');
        fireFileWatcher('changed', '/w/src/main.ts');
        fireFileWatcher('changed', '/elsewhere/.true-import-cost/a.json');
        watcher.dispose();
        fireFileWatcher('changed', '/w/.true-import-cost/a.json');

        expect(seen).toEqual(['changed /w/.true-import-cost/a.json', 'deleted /w/a/.true-import-cost/b.json']);
        expect(watcherCount()).toBe(0);
    });
});

describe('configuration', () => {
    it('prefers the folder value, then the workspace value, then the user value', () => {
        const [folder] = setWorkspaceFolders('/w');
        setSetting('section.key', 'user', 'global');
        expect(vscode.workspace.getConfiguration('section').get('key')).toBe('user');

        setSetting('section.key', 'workspace');
        expect(vscode.workspace.getConfiguration('section', folder!.uri).get('key')).toBe('workspace');

        setSetting('section.key', 'folder', folder!.uri);
        expect(vscode.workspace.getConfiguration('section', folder!.uri).get('key')).toBe('folder');
        expect(vscode.workspace.getConfiguration('section').get('key')).toBe('workspace');
        expect(vscode.workspace.getConfiguration('section', folder!.uri).inspect('key')).toMatchObject({
            globalValue: 'user',
            workspaceValue: 'workspace',
            workspaceFolderValue: 'folder',
        });
    });

    it('hands out copies, so changing a value read does not change the setting', () => {
        setSetting('section.list', [{ a: 1 }]);

        vscode.workspace.getConfiguration('section').get<{ a: number }[]>('list')!.push({ a: 2 });

        expect(vscode.workspace.getConfiguration('section').get('list')).toEqual([{ a: 1 }]);
    });

    it('writes an update to its target, records it and announces the change', async () => {
        const [folder] = setWorkspaceFolders('/w');
        const changed: boolean[] = [];
        const listening = vscode.workspace.onDidChangeConfiguration(event => changed.push(event.affectsConfiguration('section.key')));

        await vscode.workspace.getConfiguration('section').update('key', 1, vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('section', folder!.uri).update('key', 2, vscode.ConfigurationTarget.WorkspaceFolder);
        await expect(vscode.workspace.getConfiguration('section').update('key', 3, vscode.ConfigurationTarget.WorkspaceFolder)).rejects.toThrow('no resource');
        listening.dispose();

        expect(flushConfigurationUpdates()).toEqual([
            { key: 'section.key', value: 1, target: vscode.ConfigurationTarget.Global },
            { key: 'section.key', value: 2, target: vscode.ConfigurationTarget.WorkspaceFolder, folder: '/w' },
        ]);
        expect(changed).toEqual([true, true]);
        expect(vscode.workspace.getConfiguration('section', folder!.uri).get('key')).toBe(2);
    });

    it('says a change affects a setting, the sections that hold it and the keys below it', () => {
        const event = configurationChange('trueImportCost.display.typeOnly');

        expect(event.affectsConfiguration('trueImportCost')).toBe(true);
        expect(event.affectsConfiguration('trueImportCost.display')).toBe(true);
        expect(event.affectsConfiguration('trueImportCost.display.typeOnly')).toBe(true);
        expect(event.affectsConfiguration('trueImportCost.display.type')).toBe(false);
        expect(event.affectsConfiguration('trueImportCost.targets')).toBe(false);
        expect(configurationChange('trueImportCost').affectsConfiguration('trueImportCost.targets')).toBe(true);
    });

    it('fires a change made through changeSetting', () => {
        const seen: boolean[] = [];
        vscode.workspace.onDidChangeConfiguration(event => seen.push(event.affectsConfiguration('a.b')));

        changeSetting('a.b', true);

        expect(seen).toEqual([true]);
        expect(vscode.workspace.getConfiguration('a').get('b')).toBe(true);
    });
});

describe('workspace folders and trust', () => {
    it('relates paths to the innermost folder and names it when there are several', () => {
        setWorkspaceFolders('/w', '/w/packages/app');

        expect(vscode.workspace.getWorkspaceFolder(vscode.Uri.file('/w/packages/app/src/a.ts'))?.name).toBe('app');
        expect(vscode.workspace.asRelativePath(vscode.Uri.file('/w/packages/app/src/a.ts'))).toBe('app/src/a.ts');
        expect(vscode.workspace.asRelativePath(vscode.Uri.file('/elsewhere/a.ts'))).toBe('/elsewhere/a.ts');

        setWorkspaceFolders('/w');
        expect(vscode.workspace.asRelativePath(vscode.Uri.file('/w/src/a.ts'))).toBe('src/a.ts');
        expect(vscode.workspace.workspaceFolders?.map(folder => folder.uri.path)).toEqual(['/w']);
    });

    it('has no folders until some are set, and tells listeners when they change', () => {
        const seen: number[] = [];
        vscode.workspace.onDidChangeWorkspaceFolders(event => seen.push(event.added.length));

        expect(vscode.workspace.workspaceFolders).toBeUndefined();
        setWorkspaceFolders('/a', '/b');

        expect(seen).toEqual([2]);
    });

    it('announces trust when it is granted, not when it is withdrawn', () => {
        let granted = 0;
        vscode.workspace.onDidGrantWorkspaceTrust(() => {
            granted++;
        });

        setWorkspaceTrusted(false);
        expect(vscode.workspace.isTrusted).toBe(false);
        setWorkspaceTrusted(true);

        expect(granted).toBe(1);
    });
});

describe('documents', () => {
    it('turns offsets into positions and back', () => {
        const document = openDocument('/w/src/a.ts', 'one\ntwo\n\nfour');

        expect(document.positionAt(5)).toMatchObject({ line: 1, character: 1 });
        expect(document.positionAt(999)).toMatchObject({ line: 3, character: 4 });
        expect(document.offsetAt(new Position(1, 1))).toBe(5);
        expect(document.offsetAt(new Position(1, 99))).toBe(7);
        expect(document.languageId).toBe('typescript');
        expect(document.lineCount).toBe(4);
    });

    it('reports an edit, a save and a close, and keeps the open documents listed', async () => {
        const seen: string[] = [];
        vscode.workspace.onDidChangeTextDocument(event => seen.push(`changed ${event.document.version} ${event.contentChanges.length}`));
        vscode.workspace.onDidSaveTextDocument(document => seen.push(`saved ${document.isDirty}`));
        vscode.workspace.onDidCloseTextDocument(document => seen.push(`closed ${document.uri.path}`));
        const document = openDocument('/w/src/a.ts', 'a');

        document.edit('b');
        expect(document.isDirty).toBe(true);
        await document.save();
        closeDocument(document);

        expect(seen).toEqual(['changed 2 1', 'saved false', 'closed /w/src/a.ts']);
        expect(vscode.workspace.textDocuments).toEqual([]);
    });

    it('knows whether a range holds a position', () => {
        const range = new vscode.Range(1, 4, 2, 0);

        expect(range.contains(new vscode.Position(1, 4))).toBe(true);
        expect(range.contains(new vscode.Position(2, 0))).toBe(true);
        expect(range.contains(new vscode.Position(1, 3))).toBe(false);
        expect(range.contains(new vscode.Position(2, 1))).toBe(false);
    });
});

describe('events', () => {
    it('counts listeners until they or their emitter are disposed', () => {
        const emitter = new vscode.EventEmitter<number>();
        const seen: number[] = [];
        const first = emitter.event(value => seen.push(value));
        emitter.event(value => seen.push(value * 10));

        emitter.fire(1);
        first.dispose();
        emitter.fire(2);
        expect(emitterListenerCount()).toBe(1);
        emitter.dispose();
        emitter.fire(3);

        expect(seen).toEqual([1, 10, 20]);
        expect(emitterListenerCount()).toBe(0);
    });

    it('counts who listens to the host events by name', () => {
        const listening = vscode.workspace.onDidOpenTextDocument(() => undefined);

        expect(hostListenerCounts()).toEqual({ 'workspace.onDidOpenTextDocument': 1 });
        listening.dispose();
        expect(hostListenerCounts()).toEqual({});
    });

    it('cancels a token once, and tells a late listener on the next turn', async () => {
        vi.useFakeTimers();
        const source = new vscode.CancellationTokenSource();
        const seen: string[] = [];
        source.token.onCancellationRequested(() => seen.push('early'));

        source.cancel();
        source.cancel();
        source.token.onCancellationRequested(() => seen.push('late'));
        expect(seen).toEqual(['early']);
        await vi.advanceTimersByTimeAsync(0);

        expect(seen).toEqual(['early', 'late']);
        expect(source.token.isCancellationRequested).toBe(true);
    });
});

describe('window and commands', () => {
    it('picks the quick pick item a test chose, never a separator', async () => {
        setQuickPickChoice(() => true);
        const picked = await vscode.window.showQuickPick([
            { label: 'Group', kind: vscode.QuickPickItemKind.Separator },
            { label: 'first' },
        ]);

        expect(picked?.label).toBe('first');
        expect(flushQuickPicks()[0]?.items.map(item => item.label)).toEqual(['Group', 'first']);
    });

    it('runs a registered command, records every command run, and refuses a second registration', async () => {
        const registration = vscode.commands.registerCommand('test.echo', (value: unknown) => value);

        expect(await vscode.commands.executeCommand('test.echo', 42)).toBe(42);
        expect(await vscode.commands.executeCommand('workbench.view.focus')).toBeUndefined();
        expect(() => vscode.commands.registerCommand('test.echo', () => undefined)).toThrow('already exists');
        registration.dispose();

        expect(flushExecutedCommands()).toEqual([{ command: 'test.echo', args: [42] }, { command: 'workbench.view.focus', args: [] }]);
        expect(registeredCommands()).toEqual([]);
    });

    it('follows provider and tree data changes until the registration goes', () => {
        const changed = new vscode.EventEmitter<void>();
        const registration = vscode.languages.registerInlayHintsProvider({ language: 'typescript' }, {
            onDidChangeInlayHints: changed.event,
            provideInlayHints: () => [],
        });
        const view = vscode.window.createTreeView('test.view', { treeDataProvider: { onDidChangeTreeData: changed.event, getChildren: () => [], getTreeItem: () => new vscode.TreeItem('x') } });

        changed.fire();
        registration.dispose();
        view.dispose();
        changed.fire();

        expect(registeredProviders('inlayHints')).toEqual([]);
        expect(treeViews()[0]?.refreshes).toBe(1);
        expect(emitterListenerCount()).toBe(0);
    });

    it('refuses to use a diagnostic collection once it is disposed', () => {
        const collection = vscode.languages.createDiagnosticCollection('test');
        const uri = vscode.Uri.file('/w/a.ts');
        collection.set(uri, [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'x', vscode.DiagnosticSeverity.Information)]);

        expect(collection.get(uri)?.map(diagnostic => diagnostic.message)).toEqual(['x']);
        expect(diagnosticCollections().map(each => each.name)).toEqual(['test']);
        collection.dispose();

        expect(() => collection.set(uri, [])).toThrow('disposed');
    });

    it('reports the active editor and its cursor', () => {
        const document = openDocument('/w/src/a.ts', 'import x from "x";');
        const seen: (string | undefined)[] = [];
        vscode.window.onDidChangeActiveTextEditor(editor => seen.push(editor?.document.uri.path));

        setActiveTextEditor(document, 7);

        expect(vscode.window.activeTextEditor?.selection.active).toMatchObject({ line: 0, character: 7 });
        expect(seen).toEqual(['/w/src/a.ts']);
    });

    it('makes an extension context with an empty workspace state', async () => {
        const context = createExtensionContext();

        await context.workspaceState.update('key', 'value');
        expect(context.workspaceState.get('key')).toBe('value');
        await context.workspaceState.update('key', undefined);

        expect(context.workspaceState.keys()).toEqual([]);
        expect(context.subscriptions).toEqual([]);
    });
});
