import * as vscode from 'vscode';

import { argumentsOf, fromActiveEditor } from './explainWhyIncluded';
import { subjectModules } from './subject';
import { followsInclusion } from '../../core/graph/reachability';
import { displayModulePath } from '../presentation/modulePaths';
import { moduleUri } from '../views/packagesTree';

import type { ImportCostService } from '../services/importCosts';
import type { LoadedTarget } from '../services/metadataLoader';
import type { SnapshotStore } from '../services/snapshotStore';

export interface ImportersDependencies {
    readonly store: SnapshotStore;
    readonly service: ImportCostService;
}

export interface ImportSite {
    readonly uri: vscode.Uri;
    readonly label: string;
    readonly range?: vscode.Range;
    readonly text?: string;
    readonly insidePackage?: string;
}

const MAX_IMPORTERS = 200;

async function sitesIn(dependencies: ImportersDependencies, target: LoadedTarget, importerId: string, subject: ReadonlySet<string>): Promise<ImportSite[]> {
    const importer = target.graph.module(importerId);
    const uri = moduleUri(target, importerId);
    if (!importer || !uri) {
        return [];
    }
    if (importer.packageName !== undefined) {
        return [{ uri, label: displayModulePath(importer), insidePackage: importer.packageName }];
    }
    const cancellation = new vscode.CancellationTokenSource();
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        const analysis = await dependencies.service.analyze(document, cancellation.token);
        const sites: ImportSite[] = [];
        for (const source of analysis?.imports ?? []) {
            const cost = dependencies.service.costIn(target, uri, source);
            const resolved = cost !== undefined && 'match' in cost ? cost.match?.edge.resolvedModule : undefined;
            if (resolved !== undefined && subject.has(resolved)) {
                const start = document.positionAt(source.range.start);
                const range = new vscode.Range(start, document.positionAt(source.range.end));
                sites.push({ uri, label: `${importer.path}:${start.line + 1}`, range, text: document.getText(range).replace(/\s+/g, ' ').trim() });
            }
        }
        return sites.length > 0 ? sites : [{ uri, label: importer.path }];
    } catch {
        return [{ uri, label: importer.path }];
    } finally {
        cancellation.dispose();
    }
}

export async function findImportSites(dependencies: ImportersDependencies, target: LoadedTarget, moduleIds: readonly string[]): Promise<ImportSite[]> {
    const subject = new Set(moduleIds);
    const importers = new Set<string>();
    for (const id of subject) {
        for (const edge of target.graph.importersOf(id)) {
            if (!subject.has(edge.importer) && followsInclusion(edge)) {
                importers.add(edge.importer);
            }
        }
    }
    const ordered = [...importers]
        .sort((a, b) => Number(target.graph.module(a)?.packageName !== undefined) - Number(target.graph.module(b)?.packageName !== undefined) || a.localeCompare(b))
        .slice(0, MAX_IMPORTERS);
    const sites = await Promise.all(ordered.map(id => sitesIn(dependencies, target, id, subject)));
    return sites.flat();
}

export async function showImporters(dependencies: ImportersDependencies, argument?: unknown): Promise<void> {
    const args = argumentsOf(argument) ?? await fromActiveEditor(dependencies);
    if (!args) {
        void vscode.window.showInformationMessage('Put the cursor on an import, or pick a package in the Bundle Contents view, to see what imports it.');
        return;
    }
    const target = dependencies.store.target(args.target);
    if (!target) {
        void vscode.window.showWarningMessage('That build target is no longer loaded. Refresh and try again.');
        return;
    }
    const modules = subjectModules(target, args);
    const single = modules.length === 1 ? target.graph.module(modules[0] as string) : undefined;
    const subject = args.label ?? args.packageName ?? (single === undefined ? 'it' : displayModulePath(single));
    const sites = await findImportSites(dependencies, target, modules);
    if (sites.length === 0) {
        void vscode.window.showInformationMessage(`Nothing in build target "${target.id}" imports ${subject}; an entry point may load it directly.`);
        return;
    }
    type Item = vscode.QuickPickItem & { readonly site: ImportSite };
    const items: Item[] = sites.map(site => ({
        label: `${site.insidePackage === undefined ? '$(file-code)' : '$(package)'} ${site.label}`,
        ...(site.text === undefined ? {} : { description: site.text }),
        ...(site.insidePackage === undefined ? {} : { description: `inside ${site.insidePackage}` }),
        site,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `${sites.length} ${sites.length === 1 ? 'place imports' : 'places import'} ${subject} in "${target.id}"`,
        matchOnDescription: true,
    });
    if (picked) {
        await vscode.window.showTextDocument(picked.site.uri, picked.site.range === undefined ? {} : { selection: picked.site.range });
    }
}
