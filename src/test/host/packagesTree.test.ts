import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { setActiveTextEditor, setWorkspaceFolders, treeViews } from '../__mocks__/vscode';
import { activateExtension, preloadParser, treeChildren, treeProvider } from './support/extension';
import { EXTENSION_HOST_KEY, writeDuplicatedLodash, writeExtensionHost } from './support/fixtures';
import { esbuildMetafile, staticImport } from './support/metafile';
import { lines, writeJson, writeSource } from './support/workspace';

import type { PackagesNode } from '../../extension/views/packagesTree';
import type { ActiveExtension, TreeEntry } from './support/extension';

let extension: ActiveExtension | undefined;

async function activated(): Promise<void> {
    extension = await activateExtension();
}

function bundleContents(): vscode.TreeDataProvider<PackagesNode> {
    return treeProvider<PackagesNode>('trueImportCost.packages');
}

function summary({ item }: TreeEntry<PackagesNode>): Record<string, unknown> {
    return {
        label: item.label,
        description: item.description,
        icon: (item.iconPath as vscode.ThemeIcon | undefined)?.id,
        contextValue: item.contextValue,
        collapsible: item.collapsibleState,
    };
}

async function child(label: string, parent?: PackagesNode): Promise<TreeEntry<PackagesNode>> {
    const found = (await treeChildren(bundleContents(), parent)).find(entry => entry.item.label === label);
    expect(found, `a "${label}" node`).toBeDefined();
    return found!;
}

beforeAll(preloadParser);

beforeEach(() => {
    setWorkspaceFolders('/w');
});

afterEach(() => {
    extension?.deactivate();
    extension = undefined;
});

describe('the Bundle Contents view', () => {
    it('is empty while there is no metadata', async () => {
        await activated();

        expect(await treeChildren(bundleContents())).toEqual([]);
    });

    it("lists the packages and the project's sources, largest first", async () => {
        writeExtensionHost();
        await activated();

        expect((await treeChildren(bundleContents())).map(summary)).toEqual([
            { label: 'lodash', description: '4.17.21 · 70 kB', icon: 'package', contextValue: 'package', collapsible: vscode.TreeItemCollapsibleState.Collapsed },
            { label: 'Project sources', description: '2.3 kB', icon: 'folder', contextValue: 'group', collapsible: vscode.TreeItemCollapsibleState.Collapsed },
            { label: 'tslib', description: '2.8.1 · 2 kB', icon: 'package', contextValue: 'package', collapsible: vscode.TreeItemCollapsibleState.Collapsed },
        ]);
    });

    it("names the target it shows in the view's description", async () => {
        writeExtensionHost();
        await activated();

        expect(treeViews().find(view => view.id === 'trueImportCost.packages')?.description).toBe('extension-host');
    });

    it('describes a package with its version, location and module count', async () => {
        writeExtensionHost();
        await activated();

        expect((await child('lodash')).item.tooltip).toBe('lodash@4.17.21\nnode_modules/lodash\n1 modules');
    });

    it("lists the project's modules by size, each opening its file", async () => {
        writeExtensionHost();
        await activated();

        const modules = await treeChildren(bundleContents(), (await child('Project sources')).node);

        expect(modules.map(summary)).toEqual([
            { label: 'src/extension.ts', description: '1.2 kB', icon: 'file-code', contextValue: 'module', collapsible: vscode.TreeItemCollapsibleState.None },
            { label: 'src/format.ts', description: '800 B', icon: 'file-code', contextValue: 'module', collapsible: vscode.TreeItemCollapsibleState.None },
            { label: 'src/log.ts', description: '300 B', icon: 'file-code', contextValue: 'module', collapsible: vscode.TreeItemCollapsibleState.None },
        ]);
        expect(modules[0]?.item.command).toEqual({ title: 'Open', command: 'vscode.open', arguments: [vscode.Uri.file('/w/src/extension.ts')] });
    });

    it("lists a package's modules by their path inside it, each opening its file", async () => {
        writeExtensionHost();
        await activated();

        const [module] = await treeChildren(bundleContents(), (await child('lodash')).node);

        expect(module?.item.label).toBe('lodash.js');
        expect(module?.item.tooltip).toBe('node_modules/lodash/lodash.js');
        expect(module?.item.command?.arguments?.map(String)).toEqual([vscode.Uri.file('/w/node_modules/lodash/lodash.js').toString()]);
    });

    it('can explain why each package and module is included', async () => {
        writeExtensionHost();
        await activated();

        const lodash = await child('lodash');
        const [module] = await treeChildren(bundleContents(), lodash.node);

        expect(lodash.node).toMatchObject({ explain: { target: EXTENSION_HOST_KEY, packageRoot: 'node_modules/lodash', label: 'lodash' } });
        expect(module?.node).toMatchObject({ explain: { target: EXTENSION_HOST_KEY, modules: ['node_modules/lodash/lodash.js'], label: 'node_modules/lodash/lodash.js' } });
    });

    it('marks a package the build bundles more than once', async () => {
        writeDuplicatedLodash();
        await activated();

        const lodash = (await treeChildren(bundleContents())).filter(entry => entry.item.label === 'lodash').map(summary);

        expect(lodash).toEqual([
            { label: 'lodash', description: '4.17.21 · 70 kB · duplicated', icon: 'warning', contextValue: 'package', collapsible: vscode.TreeItemCollapsibleState.Collapsed },
            { label: 'lodash', description: '3.10.1 · 60 kB · duplicated', icon: 'warning', contextValue: 'package', collapsible: vscode.TreeItemCollapsibleState.Collapsed },
        ]);
    });

    it("groups the modules the bundler generated apart from the project's sources", async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 400, imports: [staticImport('virtual:env', 'virtual-module:env')] },
                'virtual-module:env': { output: 1_500 },
            },
        }));
        await activated();

        const generated = await child('Generated by the bundler');
        const [module] = await treeChildren(bundleContents(), generated.node);

        expect(summary(generated)).toMatchObject({ description: '1.5 kB', icon: 'gear', contextValue: 'group' });
        expect(module?.item.label).toBe('virtual-module:env');
        expect(module?.item.command).toBeUndefined();
    });

    it('leaves out packages and modules the build kept nothing of', async () => {
        writeJson('/w/.true-import-cost/app.json', esbuildMetafile({
            entry: 'src/main.ts',
            inputs: {
                'src/main.ts': { output: 400, imports: [staticImport('lodash-es', 'node_modules/lodash-es/lodash.js'), staticImport('./types', 'src/types.ts')] },
                'node_modules/lodash-es/lodash.js': { output: 0 },
                'src/types.ts': { output: 0 },
            },
        }));
        await activated();

        const roots = await treeChildren(bundleContents());
        const sources = await treeChildren(bundleContents(), roots[0]?.node);

        expect(roots.map(entry => entry.item.label)).toEqual(['Project sources']);
        expect(sources.map(entry => entry.item.label)).toEqual(['src/main.ts']);
    });

    it('shows the target of the active file, and refreshes when that changes', async () => {
        writeJson('/w/.true-import-cost/node.json', esbuildMetafile({ entry: 'src/server.ts', inputs: { 'src/server.ts': { output: 3_000 } } }));
        writeJson('/w/.true-import-cost/web.json', esbuildMetafile({ entry: 'src/client.ts', inputs: { 'src/client.ts': { output: 9_000 } } }));
        const client = writeSource('/w/src/client.ts', lines('export {};'));
        await activated();
        const view = treeViews().find(each => each.id === 'trueImportCost.packages')!;
        const refreshes = view.refreshes;

        setActiveTextEditor(client);
        const sources = await treeChildren(bundleContents(), (await child('Project sources')).node);

        expect(view.description).toBe('web');
        expect(view.refreshes).toBe(refreshes + 1);
        expect(sources.map(entry => entry.item.label)).toEqual(['src/client.ts']);
    });
});
