import { isRelativeSpecifier, parseBareSpecifier } from '../packages';
import { basename, dirname, joinPath, normalizePath, relativePath, splitQuery } from '../paths';

import type { BuildGraph } from '../graph/buildGraph';
import type { ImportEdge } from '../schema/snapshot';

export type MatchConfidence = 'exact' | 'resolved' | 'heuristic';

export interface ImportMatch {
    readonly edge: ImportEdge;
    readonly confidence: MatchConfidence;
}

export type MatchKindHint = 'static' | 'dynamic' | 'require';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.json', '.css', '.scss', '.sass', '.less', '.styl'];

const JS_EXTENSION = /\.(m|c)?jsx?$/;

function candidatePaths(base: string): string[] {
    const normalized = normalizePath(base);
    const candidates = [normalized, ...SOURCE_EXTENSIONS.map(extension => normalized + extension)];
    const js = JS_EXTENSION.exec(normalized);
    if (js) {
        const stem = normalized.slice(0, -js[0].length);
        candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
    }
    candidates.push(...SOURCE_EXTENSIONS.map(extension => `${normalized}/index${extension}`));
    return candidates;
}

function preferKind(edges: readonly ImportEdge[], hint: MatchKindHint | undefined): ImportEdge | undefined {
    if (hint !== undefined) {
        const wanted = hint === 'static' ? ['static', 'css'] : [hint];
        const preferred = edges.find(edge => wanted.includes(edge.kind));
        if (preferred) {
            return preferred;
        }
    }
    return edges[0];
}

function withoutExtension(path: string): string {
    const name = basename(path);
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? path : path.slice(0, path.length - (name.length - dot));
}

function subpathScore(pathInPackage: string, subpath: string, packageName: string): number {
    const stem = withoutExtension(pathInPackage);
    if (subpath === '') {
        const depth = stem.split('/').length - 1;
        const name = basename(stem);
        const mainLike = name === 'index' || name === 'main' || name === basename(packageName);
        return 50 - depth * 5 + (mainLike ? 10 : 0);
    }
    const wanted = withoutExtension(subpath);
    if (stem === wanted || stem === `${wanted}/index`) {
        return 100;
    }
    if (stem.endsWith(`/${wanted}`) || stem.endsWith(`/${wanted}/index`)) {
        return 80;
    }
    if (stem.startsWith(`${wanted}/`)) {
        return 60;
    }
    if (stem.includes(`/${wanted}/`)) {
        return 40;
    }
    return 0;
}

function aliasTail(specifier: string): string | undefined {
    const stripped = specifier.replace(/^(@\/|~\/|#|\$|@@\/)/, '');
    if (stripped === specifier && !specifier.includes('/')) {
        return undefined;
    }
    const tail = stripped.replace(/^\/+/, '');
    return tail === '' ? undefined : withoutExtension(tail);
}

export function matchImport(
    graph: BuildGraph,
    importerIds: readonly string[],
    documentPath: string,
    specifier: string,
    hint?: MatchKindHint,
): ImportMatch | undefined {
    const edges = importerIds.flatMap(id => graph.importsOf(id));
    if (edges.length === 0) {
        return undefined;
    }

    const exact = preferKind(edges.filter(edge => edge.specifier === specifier), hint);
    if (exact) {
        return { edge: exact, confidence: 'exact' };
    }

    const resolved = edges.filter(edge => edge.resolvedModule !== undefined);
    const pathOf = (edge: ImportEdge): string | undefined => graph.module(edge.resolvedModule as string)?.path;

    if (isRelativeSpecifier(specifier) || specifier.startsWith('/')) {
        const { path: target, query } = splitQuery(specifier);
        const base = target.startsWith('/') ? target.slice(1) : joinPath(dirname(documentPath), target);
        for (const candidate of candidatePaths(base)) {
            const atPath = resolved.filter(each => pathOf(each) === candidate);
            const withQuery = query === '' ? [] : atPath.filter(each => each.resolvedModule?.endsWith(query));
            const edge = preferKind(withQuery.length > 0 ? withQuery : atPath, hint);
            if (edge) {
                return { edge, confidence: 'resolved' };
            }
        }
        return undefined;
    }

    const parts = parseBareSpecifier(specifier);
    if (parts) {
        const packageEdges = resolved.filter(edge => graph.module(edge.resolvedModule as string)?.packageName === parts.packageName);
        if (packageEdges.length > 0) {
            let best: ImportEdge | undefined;
            let bestScore = -Infinity;
            for (const edge of packageEdges) {
                const module = graph.module(edge.resolvedModule as string);
                const inPackage = module?.packageRoot === undefined ? module?.path ?? '' : relativePath(module.packageRoot, module.path);
                const score = subpathScore(inPackage, parts.subpath, parts.packageName) + (hint !== undefined && edge.kind === hint ? 1 : 0);
                if (score > bestScore) {
                    best = edge;
                    bestScore = score;
                }
            }
            if (best) {
                return { edge: best, confidence: 'resolved' };
            }
        }
        const external = edges.find(edge => edge.external && edge.specifier !== undefined && parseBareSpecifier(edge.specifier)?.packageName === parts.packageName);
        if (external) {
            return { edge: external, confidence: 'resolved' };
        }
    }

    const tail = aliasTail(specifier);
    if (tail !== undefined) {
        const matches = resolved.filter((edge) => {
            const path = pathOf(edge);
            if (path === undefined) {
                return false;
            }
            const stem = withoutExtension(path);
            return stem === tail || stem.endsWith(`/${tail}`) || stem.endsWith(`/${tail}/index`);
        });
        const unique = new Set(matches.map(edge => edge.resolvedModule));
        if (unique.size === 1) {
            const edge = preferKind(matches, hint);
            if (edge) {
                return { edge, confidence: 'heuristic' };
            }
        }
    }
    return undefined;
}
