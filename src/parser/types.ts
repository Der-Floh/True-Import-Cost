export type ScriptLanguage = 'ts' | 'tsx' | 'js' | 'jsx';

export type SourceImportKind =
    | 'default'
    | 'named'
    | 'namespace'
    | 'side-effect'
    | 'dynamic'
    | 'require'
    | 'import-equals'
    | 're-export'
    | 'export-all';

export interface TextRange {
    readonly start: number;
    readonly end: number;
}

export type MemberUsageKind = 'call' | 'construct' | 'access' | 'destructure';

export interface MemberUsage {
    readonly name: string;
    readonly kind: MemberUsageKind;
}

export interface BindingUsage {
    readonly local: string;
    readonly imported: string;
    readonly typeOnly: boolean;
    readonly valueReferences: number;
    readonly typeReferences: number;
    readonly templateReferences: number;
    readonly calls: number;
    readonly members: readonly MemberUsage[];
    readonly escapes: boolean;
    readonly dynamicAccess: boolean;
}

export interface SourceImport {
    readonly specifier: string;
    readonly kind: SourceImportKind;
    readonly typeOnly: boolean;
    readonly range: TextRange;
    readonly specifierRange: TextRange;
    readonly bindings: readonly BindingUsage[];
    readonly hasValueUsage?: boolean;
}

export interface AnalyzeOptions {
    readonly usage: boolean;
}

export interface DocumentAnalysis {
    readonly imports: readonly SourceImport[];
    readonly usageAnalysed: boolean;
}

export interface ReExport {
    readonly name: string;
    readonly imported: string;
    readonly specifier: string;
}

export interface ModuleExports {
    readonly kind: 'esm';
    readonly local: readonly string[];
    readonly reExports: readonly ReExport[];
    readonly exportAll: readonly string[];
    readonly ownImports: readonly string[];
}

export type ExportAnalysis = ModuleExports | { readonly kind: 'unknown' };
