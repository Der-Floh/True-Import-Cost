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
const MAX_SOURCE_BYTES = 2_000_000;

async function sourceText(uri: vscode.Uri): Promise<string | undefined> {
    const open = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
    if (open) {
        return open.getText();
    }
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return stat.size > MAX_SOURCE_BYTES ? undefined : new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
        return undefined;
    }
}

function lineStarts(text: string): number[] {
    const starts = [0];
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
        starts.push(index + 1);
    }
    return starts;
}

function positionAt(starts: readonly number[], offset: number): vscode.Position {
    let line = 0;
    let last = starts.length - 1;
    while (line < last) {
        const middle = Math.ceil((line + last) / 2);
        if ((starts[middle] ?? 0) <= offset) {
            line = middle;
        } else {
            last = middle - 1;
        }
    }
    return new vscode.Position(line, offset - (starts[line] ?? 0));
}

async function sitesIn(dependencies: ImportersDependencies, target: LoadedTarget, importerId: string, subject: ReadonlySet<string>): Promise<ImportSite[]> {
    const importer = target.graph.module(importerId);
    const uri = moduleUri(target, importerId);
    if (!importer || !uri) {
        return [];
    }
    if (importer.packageName !== undefined) {
        return [{ uri, label: displayModulePath(importer), insidePackage: importer.packageName }];
    }
    const text = await sourceText(uri);
    if (text === undefined) {
        return [{ uri, label: importer.path }];
    }
    const analysis = await dependencies.service.importsIn(uri.path, text);
    const starts = lineStarts(text);
    const sites = analysis.imports.flatMap((source): ImportSite[] => {
        const cost = dependencies.service.costIn(target, uri, source);
        const resolved = cost !== undefined && 'match' in cost ? cost.match?.edge.resolvedModule : undefined;
        if (resolved === undefined || !subject.has(resolved)) {
            return [];
        }
        const range = new vscode.Range(positionAt(starts, source.range.start), positionAt(starts, source.range.end));
        const statement = text.slice(source.range.start, source.range.end).replace(/\s+/g, ' ').trim();
        return [{ uri, label: `${importer.path}:${range.start.line + 1}`, range, text: statement }];
    });
    return sites.length > 0 ? sites : [{ uri, label: importer.path }];
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
