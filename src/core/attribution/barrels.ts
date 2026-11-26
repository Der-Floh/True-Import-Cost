import { matchImport } from './match';
import { followsInclusion } from '../graph/reachability';

import type { BuildGraph } from '../graph/buildGraph';
import type { ImportScope } from '../graph/impact';
import type { ImportEdge } from '../schema/snapshot';

export interface ReExportRecord {
    readonly name: string;
    readonly imported: string;
    readonly specifier: string;
}

export type ModuleExports =
    | {
        readonly kind: 'esm';
        readonly local: readonly string[];
        readonly reExports: readonly ReExportRecord[];
        readonly exportAll: readonly string[];
        readonly ownImports: readonly string[];
    }
    | { readonly kind: 'unknown' };

export type ExportResolver = (moduleId: string) => ModuleExports | undefined;

export interface BarrelTrace extends ImportScope {
    readonly names: readonly string[];
    readonly definers: readonly string[];
}

interface Definition {
    readonly definers: ReadonlySet<string>;
    readonly passThrough: ReadonlySet<string>;
}

type Lookup = Definition | 'absent' | 'unknown';

interface TraceContext {
    readonly graph: BuildGraph;
    readonly exportsOf: ExportResolver;
    lookups: number;
}

const MAX_DEPTH = 32;
const MAX_LOOKUPS = 10_000;
const MAX_FACADES = 8;

const NOTHING: Definition = { definers: new Set(), passThrough: new Set() };

const resolutions = new WeakMap<BuildGraph, Map<string, string | null>>();

function resolveSpecifier(graph: BuildGraph, from: string, specifier: string): string | undefined {
    let cache = resolutions.get(graph);
    if (!cache) {
        cache = new Map();
        resolutions.set(graph, cache);
    }
    const key = `${from}\u0000${specifier}`;
    const known = cache.get(key);
    if (known !== undefined) {
        return known ?? undefined;
    }
    const path = graph.module(from)?.path;
    const match = path === undefined ? undefined : matchImport(graph, [from], path, specifier, 'static');
    const resolved = match === undefined || match.edge.external ? undefined : match.edge.resolvedModule;
    cache.set(key, resolved ?? null);
    return resolved;
}

function fansOut(graph: BuildGraph, moduleId: string): boolean {
    let current: string | undefined = moduleId;
    for (let hops = 0; current !== undefined && hops < MAX_FACADES; hops++) {
        const targets: ReadonlySet<string | undefined> = new Set(graph.importsOf(current).filter(followsInclusion).map(edge => edge.resolvedModule));
        if (targets.size > 1) {
            return true;
        }
        current = [...targets][0];
    }
    return false;
}

function definedIn(moduleId: string): Definition {
    return { definers: new Set([moduleId]), passThrough: new Set() };
}

function passedOnBy(moduleId: string, definition: Definition): Definition {
    return { definers: definition.definers, passThrough: new Set([moduleId, ...definition.passThrough]) };
}

function combine(first: Definition, second: Definition): Definition {
    return { definers: new Set([...first.definers, ...second.definers]), passThrough: new Set([...first.passThrough, ...second.passThrough]) };
}

function lookup(context: TraceContext, moduleId: string, name: string, path: readonly string[]): Lookup {
    const key = `${moduleId}\u0000${name}`;
    if (path.includes(key)) {
        return 'absent';
    }
    if (path.length >= MAX_DEPTH || ++context.lookups > MAX_LOOKUPS) {
        return 'unknown';
    }
    const exports = context.exportsOf(moduleId);
    if (exports?.kind !== 'esm' || exports.local.includes(name)) {
        return definedIn(moduleId);
    }
    const next = [...path, key];
    const reExport = exports.reExports.find(each => each.name === name);
    if (reExport) {
        const target = resolveSpecifier(context.graph, moduleId, reExport.specifier);
        if (target === undefined) {
            return 'unknown';
        }
        const inner = reExport.imported === '*' ? 'absent' : lookup(context, target, reExport.imported, next);
        return passedOnBy(moduleId, typeof inner === 'string' ? definedIn(target) : inner);
    }
    if (name === 'default') {
        return 'absent';
    }
    let found = NOTHING;
    let unknown = false;
    for (const specifier of exports.exportAll) {
        const target = resolveSpecifier(context.graph, moduleId, specifier);
        const inner = target === undefined ? 'unknown' : lookup(context, target, name, next);
        if (inner === 'unknown') {
            unknown = true;
        } else if (inner !== 'absent') {
            found = combine(found, inner);
        }
    }
    if (found.definers.size > 0) {
        return passedOnBy(moduleId, found);
    }
    return unknown ? 'unknown' : 'absent';
}

function ownEdges(graph: BuildGraph, moduleId: string, exports: ModuleExports | undefined): ImportEdge[] {
    const edges = graph.importsOf(moduleId).filter(followsInclusion);
    if (exports?.kind !== 'esm') {
        return edges;
    }
    const resolve = (specifier: string): string | undefined => resolveSpecifier(graph, moduleId, specifier);
    const own = new Set(exports.ownImports.map(resolve));
    const reExported = new Set([...exports.reExports.map(each => each.specifier), ...exports.exportAll].map(resolve));
    return edges.filter(edge => own.has(edge.resolvedModule) || !reExported.has(edge.resolvedModule));
}

export function traceBarrel(graph: BuildGraph, moduleId: string, names: readonly string[], exportsOf: ExportResolver): BarrelTrace | undefined {
    const wanted = [...new Set(names)];
    if (wanted.length === 0 || !fansOut(graph, moduleId)) {
        return undefined;
    }
    const context: TraceContext = { graph, exportsOf, lookups: 0 };
    let found = NOTHING;
    for (const name of wanted) {
        const result = lookup(context, moduleId, name, []);
        if (typeof result === 'string' || result.definers.has(moduleId)) {
            return undefined;
        }
        found = combine(found, result);
    }

    const eagerRoots = new Set(found.definers);
    const lazyRoots = new Set<string>();
    for (const id of found.passThrough) {
        for (const edge of ownEdges(graph, id, exportsOf(id))) {
            (edge.kind === 'dynamic' ? lazyRoots : eagerRoots).add(edge.resolvedModule as string);
        }
    }
    return {
        moduleId,
        names: wanted,
        definers: [...found.definers].sort(),
        passThrough: [moduleId, ...[...found.passThrough].filter(id => id !== moduleId).sort()],
        eagerRoots: [...eagerRoots].sort(),
        lazyRoots: [...lazyRoots].filter(id => !eagerRoots.has(id)).sort(),
    };
}
