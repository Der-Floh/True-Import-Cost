import { traceBarrel } from './barrels';
import { matchImport } from './match';
import { duplicateOf } from '../graph/duplicates';
import { importImpact, scopedImpact, wholeModule } from '../graph/impact';

import type { BarrelTrace, ExportResolver } from './barrels';
import type { ImportMatch, MatchKindHint } from './match';
import type { BuildGraph, PackageInstance } from '../graph/buildGraph';
import type { DuplicatePackage } from '../graph/duplicates';
import type { ImportImpact, ImportScope } from '../graph/impact';
import type { ModuleRecord } from '../schema/snapshot';

export type ImportQueryKind = 'static' | 'dynamic' | 'require' | 're-export';

export interface ImportQuery {
    readonly specifier: string;
    readonly kind: ImportQueryKind;
    readonly typeOnly: boolean;
    readonly sideEffectOnly?: boolean;
    readonly hasValueUsage?: boolean;
    readonly names?: readonly string[];
}

export interface BarrelContext {
    readonly exportsOf: ExportResolver;
    readonly otherImports?: readonly ImportQuery[];
}

export interface ModuleCost {
    readonly match: ImportMatch;
    readonly module: ModuleRecord;
    readonly impact: ImportImpact;
    readonly lazy: boolean;
    readonly package?: PackageInstance;
    readonly duplicate?: DuplicatePackage;
    readonly barrel?: BarrelTrace;
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

function traceQuery(graph: BuildGraph, moduleId: string, query: ImportQuery, exportsOf: ExportResolver): BarrelTrace | undefined {
    return query.kind === 'static' && query.names !== undefined ? traceBarrel(graph, moduleId, query.names, exportsOf) : undefined;
}

function keptByOtherImports(location: DocumentLocation, query: ImportQuery, moduleId: string, barrels: BarrelContext): ImportScope[] {
    const { graph, importerIds, documentPath } = location;
    return (barrels.otherImports ?? []).flatMap((other) => {
        if (other === query || other.typeOnly || other.hasValueUsage === false) {
            return [];
        }
        const match = matchImport(graph, importerIds, documentPath, other.specifier, hintFor(other.kind));
        if (match?.edge.resolvedModule !== moduleId) {
            return [];
        }
        return [traceQuery(graph, moduleId, other, barrels.exportsOf) ?? wholeModule(moduleId)];
    });
}

function measureImport(location: DocumentLocation, query: ImportQuery, moduleId: string, barrels: BarrelContext | undefined): { readonly impact: ImportImpact; readonly barrel?: BarrelTrace } {
    const { graph, importerIds } = location;
    if (barrels !== undefined) {
        const barrel = traceQuery(graph, moduleId, query, barrels.exportsOf);
        if (barrel !== undefined) {
            return { impact: scopedImpact(graph, importerIds, barrel, keptByOtherImports(location, query, moduleId, barrels)), barrel };
        }
    }
    return { impact: importImpact(graph, importerIds, moduleId) };
}

export function attributeImport(location: DocumentLocation, query: ImportQuery, barrels?: BarrelContext): ImportCost {
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
    const { impact, barrel } = measureImport(location, query, module.id, barrels);
    const instance = graph.packageOf(module.id);
    const duplicate = instance === undefined ? undefined : duplicateOf(graph, instance.name);
    const cost: ModuleCost = {
        match,
        module,
        impact,
        lazy: edge.kind === 'dynamic',
        ...(instance === undefined ? {} : { package: instance }),
        ...(duplicate === undefined ? {} : { duplicate }),
        ...(barrel === undefined ? {} : { barrel }),
    };
    return impact.bundledBytes + impact.lazyBytes > 0
        ? { status: 'bundled', ...cost }
        : { status: 'tree-shaken', ...cost };
}
