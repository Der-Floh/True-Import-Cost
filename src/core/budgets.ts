import type { SizeTotals } from './chunks';
import type { BuildGraph } from './graph/buildGraph';

export type BudgetKind = 'total' | 'initial' | 'javascript' | 'css' | 'package';

export interface Budget {
    readonly total?: number;
    readonly initial?: number;
    readonly javascript?: number;
    readonly css?: number;
    readonly import?: number;
    readonly packages: ReadonlyMap<string, number>;
}

export interface BudgetResult {
    readonly kind: BudgetKind;
    readonly label: string;
    readonly limit: number;
    readonly actual: number;
    readonly exceeded: boolean;
}

export const ANY_TARGET = '*';

const UNITS: Readonly<Record<string, number>> = {
    '': 1,
    b: 1,
    kb: 1000,
    kib: 1024,
    mb: 1000 ** 2,
    mib: 1024 ** 2,
    gb: 1000 ** 3,
    gib: 1024 ** 3,
};

const SIZE = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i;

const TOTAL_KINDS = ['total', 'initial', 'javascript', 'css'] as const;

const MAX_PACKAGE_BUDGETS = 200;

export function parseSize(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
    }
    if (typeof value !== 'string') {
        return undefined;
    }
    const match = SIZE.exec(value);
    const multiplier = UNITS[(match?.[2] ?? '').toLowerCase()];
    if (!match || multiplier === undefined) {
        return undefined;
    }
    return Math.round(Number(match[1]) * multiplier);
}

function parseBudget(value: unknown): Budget | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const packages = new Map<string, number>();
    if (typeof record.packages === 'object' && record.packages !== null && !Array.isArray(record.packages)) {
        for (const [glob, limit] of Object.entries(record.packages as Record<string, unknown>).slice(0, MAX_PACKAGE_BUDGETS)) {
            const bytes = parseSize(limit);
            if (glob.trim() !== '' && bytes !== undefined) {
                packages.set(glob.trim(), bytes);
            }
        }
    }
    const budget: { -readonly [K in keyof Budget]: Budget[K] } = { packages };
    for (const key of [...TOTAL_KINDS, 'import'] as const) {
        const bytes = parseSize(record[key]);
        if (bytes !== undefined) {
            budget[key] = bytes;
        }
    }
    return budget;
}

export function parseBudgets(value: unknown): ReadonlyMap<string, Budget> {
    const budgets = new Map<string, Budget>();
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return budgets;
    }
    for (const [target, entry] of Object.entries(value as Record<string, unknown>)) {
        const budget = parseBudget(entry);
        if (budget && target.trim() !== '') {
            budgets.set(target.trim(), budget);
        }
    }
    return budgets;
}

export function budgetFor(budgets: ReadonlyMap<string, Budget>, targetId: string): Budget | undefined {
    const general = budgets.get(ANY_TARGET);
    const specific = budgets.get(targetId);
    if (!general || !specific) {
        return specific ?? general;
    }
    return {
        ...general,
        ...Object.fromEntries(Object.entries(specific).filter(([key, bytes]) => key !== 'packages' && bytes !== undefined)),
        packages: new Map([...general.packages, ...specific.packages]),
    };
}

function globToPattern(glob: string): RegExp {
    const escaped = glob.split('*').map(part => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*');
    return new RegExp(`^${escaped}$`);
}

export function packageLimit(budget: Budget, packageName: string): number | undefined {
    const exact = budget.packages.get(packageName);
    if (exact !== undefined) {
        return exact;
    }
    for (const [glob, limit] of budget.packages) {
        if (glob.includes('*') && globToPattern(glob).test(packageName)) {
            return limit;
        }
    }
    return undefined;
}

const TOTAL_LABELS: Readonly<Record<(typeof TOTAL_KINDS)[number], string>> = {
    total: 'Total output',
    initial: 'Initial load',
    javascript: 'JavaScript',
    css: 'CSS',
};

export function evaluateBudgets(budget: Budget, totals: SizeTotals, graph: BuildGraph): BudgetResult[] {
    const results: BudgetResult[] = [];
    for (const kind of TOTAL_KINDS) {
        const limit = budget[kind];
        if (limit !== undefined) {
            results.push({ kind, label: TOTAL_LABELS[kind], limit, actual: totals[kind], exceeded: totals[kind] > limit });
        }
    }
    if (budget.packages.size > 0) {
        const byName = new Map<string, number>();
        for (const instance of graph.packages().values()) {
            byName.set(instance.name, (byName.get(instance.name) ?? 0) + instance.bytes);
        }
        for (const [name, bytes] of [...byName].sort((a, b) => b[1] - a[1])) {
            const limit = packageLimit(budget, name);
            if (limit !== undefined && bytes > 0) {
                results.push({ kind: 'package', label: name, limit, actual: bytes, exceeded: bytes > limit });
            }
        }
    }
    return results;
}
