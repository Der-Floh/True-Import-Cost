export type BuildModeDto = 'production' | 'development';

export type AssetKindDto = 'image' | 'font' | 'wasm' | 'html' | 'other';

export type LoadingDto = 'initial' | 'lazy';

export type ChangeStatusDto = 'added' | 'removed' | 'changed' | 'unchanged';

export type TreemapKindDto = 'root' | 'package' | 'project' | 'generated' | 'module' | 'other';

export type BudgetKindDto = 'total' | 'initial' | 'javascript' | 'css' | 'package';

export interface SizeTotalsDto {
    readonly total: number;
    readonly javascript: number;
    readonly css: number;
    readonly assets: number;
    readonly initial: number;
    readonly lazy: number;
}

export interface TargetSummaryDto {
    readonly key: string;
    readonly id: string;
    readonly bundler: string;
    readonly mode?: BuildModeDto;
    readonly createdAt: number;
    readonly totalBytes: number;
    readonly failure?: string;
}

export interface TreemapNodeDto {
    readonly id: string;
    readonly label: string;
    readonly bytes: number;
    readonly kind: TreemapKindDto;
    readonly lazy: boolean;
    readonly duplicate?: boolean;
    readonly moduleId?: string;
    readonly packageName?: string;
    readonly openable?: boolean;
    readonly children?: readonly TreemapNodeDto[];
}

export interface PackageChangeDto {
    readonly status: ChangeStatusDto;
    readonly before: number;
    readonly delta: number;
    readonly versionsBefore: readonly string[];
}

export interface BudgetStateDto {
    readonly kind: BudgetKindDto;
    readonly label: string;
    readonly limit: number;
    readonly actual: number;
    readonly exceeded: boolean;
}

export interface PackageRowDto {
    readonly name: string;
    readonly versions: readonly string[];
    readonly bytes: number;
    readonly lazyBytes: number;
    readonly modules: number;
    readonly duplicate: boolean;
    readonly change?: PackageChangeDto;
    readonly budget?: BudgetStateDto;
}

export interface ChunkRowDto {
    readonly id: string;
    readonly kind: 'js' | 'css';
    readonly bytes: number;
    readonly loading: LoadingDto;
    readonly entry: boolean;
    readonly entryModule?: string;
    readonly delta?: number;
}

export interface AssetFileDto {
    readonly id: string;
    readonly bytes: number;
}

export interface AssetGroupDto {
    readonly kind: AssetKindDto;
    readonly bytes: number;
    readonly files: readonly AssetFileDto[];
}

export interface DuplicateInstanceDto {
    readonly version?: string;
    readonly root: string;
    readonly bytes: number;
}

export interface DuplicateDto {
    readonly name: string;
    readonly bytes: number;
    readonly instances: readonly DuplicateInstanceDto[];
}

export interface HistoryPointDto {
    readonly createdAt: number;
    readonly total: number;
    readonly javascript: number;
    readonly css: number;
    readonly initial: number;
}

export interface BaselineDto {
    readonly label: string;
    readonly source: 'pinned' | 'file';
    readonly createdAt: number;
    readonly totals: SizeTotalsDto;
}

export interface ModuleChangeDto {
    readonly id: string;
    readonly label: string;
    readonly before: number;
    readonly after: number;
    readonly delta: number;
}

export interface TargetDashboardDto {
    readonly key: string;
    readonly id: string;
    readonly bundler: string;
    readonly mode?: BuildModeDto;
    readonly createdAt: number;
    readonly metadataPath: string;
    readonly estimated: boolean;
    readonly totals: SizeTotalsDto;
    readonly baseline?: BaselineDto;
    readonly treemap: TreemapNodeDto;
    readonly packages: readonly PackageRowDto[];
    readonly chunks: readonly ChunkRowDto[];
    readonly assets: readonly AssetGroupDto[];
    readonly duplicates: readonly DuplicateDto[];
    readonly history: readonly HistoryPointDto[];
    readonly budgets: readonly BudgetStateDto[];
    readonly moduleChanges: readonly ModuleChangeDto[];
}

export interface TargetComparisonDto {
    readonly targets: readonly { readonly key: string; readonly id: string }[];
    readonly rows: readonly { readonly name: string; readonly bytes: readonly (number | null)[] }[];
}

export interface DashboardModel {
    readonly targets: readonly TargetSummaryDto[];
    readonly selected?: TargetDashboardDto;
    readonly comparison?: TargetComparisonDto;
    readonly historyEnabled: boolean;
}
