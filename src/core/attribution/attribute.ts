import { matchImport } from './match';
import { duplicateOf } from '../graph/duplicates';
import { importImpact } from '../graph/impact';

import type { ImportMatch, MatchKindHint } from './match';
import type { BuildGraph, PackageInstance } from '../graph/buildGraph';
import type { DuplicatePackage } from '../graph/duplicates';
import type { ImportImpact } from '../graph/impact';
import type { ModuleRecord } from '../schema/snapshot';

export type ImportQueryKind = 'static' | 'dynamic' | 'require' | 're-export';

export interface ImportQuery {
    readonly specifier: string;
    readonly kind: ImportQueryKind;
    readonly typeOnly: boolean;
    readonly sideEffectOnly?: boolean;
    readonly hasValueUsage?: boolean;
}

export interface ModuleCost {
    readonly match: ImportMatch;
    readonly module: ModuleRecord;
    readonly impact: ImportImpact;
    readonly lazy: boolean;
    readonly package?: PackageInstance;
    readonly duplicate?: DuplicatePackage;
}

export type ImportCost =
    | ({ readonly status: 'bundled' } & ModuleCost)
    | ({ readonly status: 'tree-shaken' } & ModuleCost)
    | { readonly status: 'external'; readonly specifier: string; readonly match: ImportMatch }
    | { readonly status: 'elided'; readonly match?: ImportMatch }
    | { readonly status: 'type-only' }
    | { readonly status: 'unresolved' };

export interface DocumentLocation {
    readonly graph: BuildGraph;
    readonly documentPath: string;
    readonly importerIds: readonly string[];
}

export function locateDocument(graph: BuildGraph, documentPath: string): DocumentLocation | undefined {
    const modules = graph.modulesAt(documentPath);
    return modules.length === 0 ? undefined : { graph, documentPath, importerIds: modules.map(module => module.id) };
}

function hintFor(kind: ImportQueryKind): MatchKindHint | undefined {
    switch (kind) {
        case 'dynamic':
            return 'dynamic';
        case 'require':
            return 'require';
        case 'static':
        case 're-export':
            return 'static';
    }
}

export function attributeImport(location: DocumentLocation, query: ImportQuery): ImportCost {
    if (query.typeOnly) {
        return { status: 'type-only' };
    }

    const { graph, importerIds, documentPath } = location;
    const match = matchImport(graph, importerIds, documentPath, query.specifier, hintFor(query.kind));
    if (!match) {
        const removable = query.hasValueUsage === false && query.sideEffectOnly !== true && query.kind !== 'dynamic';
        return removable ? { status: 'elided' } : { status: 'unresolved' };
    }

    const { edge } = match;
    if (edge.external || edge.resolvedModule === undefined) {
        return edge.retained === false
            ? { status: 'elided', match }
            : { status: 'external', specifier: edge.specifier ?? query.specifier, match };
    }

    const module = graph.module(edge.resolvedModule);
    if (!module) {
        return { status: 'unresolved' };
    }
    const impact = importImpact(graph, importerIds, module.id);
    const instance = graph.packageOf(module.id);
    const duplicate = instance === undefined ? undefined : duplicateOf(graph, instance.name);
    const cost: ModuleCost = {
        match,
        module,
        impact,
        lazy: edge.kind === 'dynamic',
        ...(instance === undefined ? {} : { package: instance }),
        ...(duplicate === undefined ? {} : { duplicate }),
    };
    return impact.bundledBytes + impact.lazyBytes > 0
        ? { status: 'bundled', ...cost }
        : { status: 'tree-shaken', ...cost };
}
