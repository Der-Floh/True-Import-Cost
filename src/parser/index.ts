import { analyzeModuleExports } from './exports';
import { analyzeScript } from './script';
import { analyzeVue } from './vue';

import type { AnalyzeOptions, DocumentAnalysis, ExportAnalysis, ScriptLanguage } from './types';

export type { AnalyzeOptions, BindingUsage, DocumentAnalysis, MemberUsage, SourceImport, SourceImportKind, TextRange } from './types';
export type { ExportAnalysis, ModuleExports, ReExport } from './types';
export { planRemoval } from './removal';
export type { PlannedRemoval } from './removal';

const LANGUAGE_IDS: Readonly<Record<string, ScriptLanguage | 'vue'>> = {
    typescript: 'ts',
    typescriptreact: 'tsx',
    javascript: 'js',
    javascriptreact: 'jsx',
    vue: 'vue',
};

const EXTENSIONS: Readonly<Record<string, ScriptLanguage | 'vue'>> = {
    '.ts': 'ts',
    '.mts': 'ts',
    '.cts': 'ts',
    '.tsx': 'tsx',
    '.js': 'js',
    '.mjs': 'js',
    '.cjs': 'js',
    '.jsx': 'jsx',
    '.vue': 'vue',
};

const COMMONJS_FILE = /\.c[jt]s$/i;

export function languageOf(languageId: string, fileName: string): ScriptLanguage | 'vue' | undefined {
    const byId = LANGUAGE_IDS[languageId];
    if (byId) {
        return byId;
    }
    const extension = /\.[a-z]+$/i.exec(fileName)?.[0]?.toLowerCase();
    return extension === undefined ? undefined : EXTENSIONS[extension];
}

export function isSupportedLanguage(languageId: string, fileName: string): boolean {
    return languageOf(languageId, fileName) !== undefined;
}

export function analyzeDocument(languageId: string, fileName: string, text: string, options: AnalyzeOptions): DocumentAnalysis {
    const language = languageOf(languageId, fileName);
    if (language === undefined) {
        return { imports: [], usageAnalysed: false };
    }
    const imports = language === 'vue'
        ? analyzeVue(text, options)
        : analyzeScript(text, language, { usage: options.usage, elidesUnusedImports: language === 'ts' || language === 'tsx' });
    return { imports, usageAnalysed: options.usage };
}

export function analyzeExports(languageId: string, fileName: string, text: string): ExportAnalysis {
    const language = languageOf(languageId, fileName);
    if (language === undefined || language === 'vue' || COMMONJS_FILE.test(fileName)) {
        return { kind: 'unknown' };
    }
    return analyzeModuleExports(text, language);
}
