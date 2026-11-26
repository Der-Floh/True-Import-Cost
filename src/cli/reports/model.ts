import type { BudgetResult } from '../../core/budgets';
import type { SizeTotals } from '../../core/chunks';
import type { ChangeStatus } from '../../core/compare';
import type { BuildMode, BundlerInfo } from '../../core/schema/snapshot';

export const REPORT_SCHEMA_VERSION = 1;

export const SUMMARY_FORMAT = 'true-import-cost/summary';

export const COMPARISON_FORMAT = 'true-import-cost/comparison';

export const BUDGET_CHECK_FORMAT = 'true-import-cost/budget-check';

export type TotalKey = keyof SizeTotals;

export interface BuildDescription {
    readonly target: string;
    readonly bundler: BundlerInfo;
    readonly mode?: BuildMode;
    readonly estimated: boolean;
}

export interface PackageSize {
    readonly name: string;
    readonly versions: readonly string[];
    readonly bytes: number;
    readonly lazyBytes: number;
    readonly modules: number;
    readonly duplicate: boolean;
}

export interface DuplicateInstance {
    readonly version?: string;
    readonly root: string;
    readonly bytes: number;
}

export interface Duplicate {
    readonly name: string;
    readonly bytes: number;
    readonly instances: readonly DuplicateInstance[];
}

export interface SummaryReport {
    readonly format: typeof SUMMARY_FORMAT;
    readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
    readonly build: BuildDescription;
    readonly totals: SizeTotals;
    readonly packageCount: number;
    readonly packages: readonly PackageSize[];
    readonly duplicates: readonly Duplicate[];
}

export interface SizeChange {
    readonly before: number;
    readonly after: number;
    readonly delta: number;
}

export interface PackageChange extends SizeChange {
    readonly name: string;
    readonly status: Exclude<ChangeStatus, 'unchanged'>;
    readonly versionsBefore: readonly string[];
    readonly versionsAfter: readonly string[];
}

export interface ChunkChange {
    readonly before?: string;
    readonly after?: string;
    readonly bytesBefore: number;
    readonly bytesAfter: number;
    readonly delta: number;
}

export interface ModuleChange extends SizeChange {
    readonly id: string;
    readonly label: string;
}

export interface ComparisonReport {
    readonly format: typeof COMPARISON_FORMAT;
    readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
    readonly baseline: BuildDescription;
    readonly current: BuildDescription;
    readonly totals: Readonly<Record<TotalKey, SizeChange>>;
    readonly packages: {
        readonly added: number;
        readonly removed: number;
        readonly changed: number;
        readonly unchanged: number;
        readonly changes: readonly PackageChange[];
    };
    readonly chunks: {
        readonly changed: number;
        readonly changes: readonly ChunkChange[];
    };
    readonly modules: {
        readonly changed: number;
        readonly changes: readonly ModuleChange[];
    };
}

export interface BudgetCheckReport {
    readonly format: typeof BUDGET_CHECK_FORMAT;
    readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
    readonly build: BuildDescription;
    readonly target: string;
    readonly passed: boolean;
    readonly exceeded: number;
    readonly results: readonly BudgetResult[];
}

export const TOTAL_KEYS: readonly TotalKey[] = ['total', 'javascript', 'css', 'assets', 'initial', 'lazy'];
