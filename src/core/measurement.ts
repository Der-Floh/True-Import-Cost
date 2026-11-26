import { compareBuilds } from './compare';

import type { SizeTotals } from './chunks';
import type { BuildGraph } from './graph/buildGraph';

export type MeasurementMethod = 'built-without' | 'compared-builds';

export interface MeasuredPackage {
    readonly name: string;
    readonly bytes: number;
}

export interface ImportMeasurement {
    readonly method: MeasurementMethod;
    readonly importer: string;
    readonly specifier: string;
    readonly measuredAt: number;
    readonly withImport: SizeTotals;
    readonly withoutImport: SizeTotals;
    readonly packages: readonly MeasuredPackage[];
    readonly modules: number;
}

export interface MeasurementSubject {
    readonly method: MeasurementMethod;
    readonly importer: string;
    readonly specifier: string;
    readonly measuredAt: number;
}

export type ImportChangeKind = 'added' | 'removed';

export interface ImportChange {
    readonly kind: ImportChangeKind;
    readonly importer: string;
    readonly specifier: string;
}

export const MAX_MEASURED_PACKAGES = 20;

const TOTAL_KEYS = ['total', 'javascript', 'css', 'assets', 'initial', 'lazy'] as const;

const MIN_DRIFT_BYTES = 256;

const DRIFT_SHARE = 0.01;

export function savingsOf(measurement: ImportMeasurement): SizeTotals {
    const { withImport, withoutImport } = measurement;
    return {
        total: withImport.total - withoutImport.total,
        javascript: withImport.javascript - withoutImport.javascript,
        css: withImport.css - withoutImport.css,
        assets: withImport.assets - withoutImport.assets,
        initial: withImport.initial - withoutImport.initial,
        lazy: withImport.lazy - withoutImport.lazy,
    };
}

export function measureImport(withImport: BuildGraph, withoutImport: BuildGraph, subject: MeasurementSubject): ImportMeasurement {
    const comparison = compareBuilds(withImport, withoutImport, Number.MAX_SAFE_INTEGER);
    return {
        ...subject,
        withImport: comparison.before,
        withoutImport: comparison.after,
        packages: comparison.packages
            .filter(change => change.delta < 0)
            .map(change => ({ name: change.name, bytes: -change.delta }))
            .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
            .slice(0, MAX_MEASURED_PACKAGES),
        modules: comparison.modules.filter(change => change.delta < 0).length,
    };
}

function isFirstParty(graph: BuildGraph, moduleId: string): boolean {
    const module = graph.module(moduleId);
    return module !== undefined && module.packageName === undefined && module.virtual !== true;
}

function importKey(importer: string, specifier: string): string {
    return `${importer}\u0001${specifier}`;
}

function firstPartyImports(graph: BuildGraph): Map<string, Omit<ImportChange, 'kind'>> {
    const imports = new Map<string, Omit<ImportChange, 'kind'>>();
    for (const edge of graph.snapshot.imports) {
        const importer = graph.module(edge.importer);
        if (edge.specifier === undefined || edge.kind === 'reference' || importer === undefined || !isFirstParty(graph, edge.importer)) {
            continue;
        }
        imports.set(importKey(importer.path, edge.specifier), { importer: importer.path, specifier: edge.specifier });
    }
    return imports;
}

export function importChanges(baseline: BuildGraph, current: BuildGraph): ImportChange[] {
    const before = firstPartyImports(baseline);
    const after = firstPartyImports(current);
    const removed = [...before].filter(([key]) => !after.has(key)).map(([, change]): ImportChange => ({ kind: 'removed', ...change }));
    const added = [...after].filter(([key]) => !before.has(key)).map(([, change]): ImportChange => ({ kind: 'added', ...change }));
    return [...removed, ...added].sort((a, b) => a.importer.localeCompare(b.importer) || a.specifier.localeCompare(b.specifier));
}

function versionsByName(graph: BuildGraph): Map<string, string> {
    const versions = new Map<string, Set<string>>();
    for (const instance of graph.packages().values()) {
        const set = versions.get(instance.name) ?? new Set<string>();
        set.add(instance.version ?? '');
        versions.set(instance.name, set);
    }
    return new Map([...versions].map(([name, set]) => [name, [...set].sort().join()]));
}

function samePackageVersions(baseline: BuildGraph, current: BuildGraph): boolean {
    const before = versionsByName(baseline);
    const after = versionsByName(current);
    return [...before].every(([name, versions]) => !after.has(name) || after.get(name) === versions);
}

function otherCodeUnchanged(baseline: BuildGraph, current: BuildGraph, importerPath: string): boolean {
    let drift = 0;
    let bytes = 0;
    for (const module of baseline.modules()) {
        if (!isFirstParty(baseline, module.id) || module.path === importerPath || current.module(module.id) === undefined) {
            continue;
        }
        const before = baseline.bytesOf(module.id);
        const after = current.bytesOf(module.id);
        if (before > 0 && after > 0) {
            drift += Math.abs(after - before);
            bytes += before;
        }
    }
    return drift <= Math.max(MIN_DRIFT_BYTES, bytes * DRIFT_SHARE);
}

export function singleImportChange(baseline: BuildGraph, current: BuildGraph): ImportChange | undefined {
    const changes = importChanges(baseline, current);
    const [change] = changes;
    if (changes.length !== 1 || change === undefined) {
        return undefined;
    }
    return samePackageVersions(baseline, current) && otherCodeUnchanged(baseline, current, change.importer) ? change : undefined;
}

export function measureComparedBuilds(baseline: BuildGraph, current: BuildGraph, change: ImportChange, measuredAt: number): ImportMeasurement {
    const subject: MeasurementSubject = { method: 'compared-builds', importer: change.importer, specifier: change.specifier, measuredAt };
    return change.kind === 'removed' ? measureImport(baseline, current, subject) : measureImport(current, baseline, subject);
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isShortText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 4096;
}

function parseTotals(value: unknown): SizeTotals | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    if (!TOTAL_KEYS.every(key => isCount(record[key]))) {
        return undefined;
    }
    const [total, javascript, css, assets, initial, lazy] = TOTAL_KEYS.map(key => record[key] as number) as [number, number, number, number, number, number];
    return { total, javascript, css, assets, initial, lazy };
}

function parsePackages(value: unknown): MeasuredPackage[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.slice(0, MAX_MEASURED_PACKAGES).flatMap((item: unknown): MeasuredPackage[] => {
        const record = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {};
        return isShortText(record.name) && isCount(record.bytes) ? [{ name: record.name, bytes: record.bytes }] : [];
    });
}

export function parseMeasurement(value: unknown): ImportMeasurement | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const withImport = parseTotals(record.withImport);
    const withoutImport = parseTotals(record.withoutImport);
    const method = record.method === 'built-without' || record.method === 'compared-builds' ? record.method : undefined;
    if (!method || !withImport || !withoutImport || !isShortText(record.importer) || !isShortText(record.specifier) || !isCount(record.measuredAt) || !isCount(record.modules)) {
        return undefined;
    }
    return {
        method,
        importer: record.importer,
        specifier: record.specifier,
        measuredAt: record.measuredAt,
        withImport,
        withoutImport,
        packages: parsePackages(record.packages),
        modules: record.modules,
    };
}
