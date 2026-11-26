export const DISPLAY_NAME = 'True Import Cost';

export const SETTINGS_SECTION = 'trueImportCost';

export const METADATA_DIRECTORY = '.true-import-cost';

export const DISCOVERY_GLOB = `**/${METADATA_DIRECTORY}/*.json`;

export const Command = {
    selectTarget: 'trueImportCost.selectTarget',
    importMetadata: 'trueImportCost.importMetadata',
    refresh: 'trueImportCost.refresh',
    explainWhyIncluded: 'trueImportCost.explainWhyIncluded',
    toggleInlayHints: 'trueImportCost.toggleInlayHints',
    clearCache: 'trueImportCost.clearCache',
    showLog: 'trueImportCost.showLog',
    showDashboard: 'trueImportCost.showDashboard',
    compareBuilds: 'trueImportCost.compareBuilds',
    showImporters: 'trueImportCost.showImporters',
    clearHistory: 'trueImportCost.clearHistory',
} as const;

export const View = {
    packages: 'trueImportCost.packages',
    whyIncluded: 'trueImportCost.whyIncluded',
} as const;

export const SUPPORTED_LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'] as const;

export const DOCUMENT_SELECTOR = SUPPORTED_LANGUAGES.map(language => ({ language }));
