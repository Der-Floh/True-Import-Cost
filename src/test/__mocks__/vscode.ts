import { resetCommands } from './vscode/commands';
import { resetConfiguration } from './vscode/configuration';
import { resetDocuments } from './vscode/documents';
import { resetEvents } from './vscode/events';
import { resetFileSystem } from './vscode/fileSystem';
import { resetFolders } from './vscode/folders';
import { resetLanguages } from './vscode/languages';
import { resetWindow } from './vscode/window';
import { resetWebviews } from './vscode/webview';
import { resetWorkspace } from './vscode/workspace';

export { commands, flushExecutedCommands, registeredCommands } from './vscode/commands';
export type { ExecutedCommand } from './vscode/commands';
export {
    changeSetting,
    ConfigurationTarget,
    configurationChange,
    fireConfigurationChange,
    flushConfigurationReads,
    flushConfigurationUpdates,
    setSetting,
} from './vscode/configuration';
export type { ConfigurationChangeEvent, ConfigurationRead, ConfigurationUpdate, SettingScope } from './vscode/configuration';
export { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from './vscode/content';
export type { Command } from './vscode/content';
export { createExtensionContext, FakeMemento } from './vscode/context';
export { closeDocument, FakeTextDocument, openDocument, Position, Range, Selection } from './vscode/documents';
export type { DocumentOptions, TextDocumentChangeEvent } from './vscode/documents';
export { CancellationTokenSource, Disposable, emitterListenerCount, EventEmitter, hostListenerCounts } from './vscode/events';
export {
    fireFileWatcher,
    flushFileReads,
    flushFileWrites,
    readVirtualFile,
    FileType,
    holdFileRead,
    removeVirtualFile,
    setFileReadError,
    setVirtualFile,
    watchedPatterns,
    watcherCount,
} from './vscode/fileSystem';
export type { FileChange, VirtualFileOptions } from './vscode/fileSystem';
export { setWorkspaceFolders } from './vscode/folders';
export type { FakeWorkspaceFolder } from './vscode/folders';
export {
    CodeAction,
    CodeActionKind,
    Diagnostic,
    diagnosticCollections,
    DiagnosticSeverity,
    Hover,
    InlayHint,
    InlayHintLabelPart,
    languages,
    matchesSelector,
    registeredProviders,
} from './vscode/languages';
export type { ProviderKind, ProviderRegistration } from './vscode/languages';
export { RelativePattern, Uri } from './vscode/uri';
export {
    FakeTextEditor,
    flushErrorMessages,
    flushInformationMessages,
    flushInputBoxes,
    flushLogs,
    flushOpenDialogs,
    flushQuickPicks,
    flushShownDocuments,
    flushWarningMessages,
    outputChannels,
    QuickPickItemKind,
    setActiveTextEditor,
    setInputBoxAnswer,
    setOpenDialogAnswer,
    setQuickPickChoice,
    setWarningMessageAnswer,
    StatusBarAlignment,
    statusBarItems,
    treeViews,
    window,
} from './vscode/window';
export type { InputBoxOptions, QuickPickItemLike, QuickPickRecord } from './vscode/window';
export { FakeWebview, FakeWebviewPanel, ViewColumn, webviewPanels } from './vscode/webview';
export type { WebviewPanelOptions } from './vscode/webview';
export { flushFileSearches, setWorkspaceTrusted, workspace } from './vscode/workspace';
export type { FileSearch } from './vscode/workspace';

export function resetMocks(): void {
    resetCommands();
    resetConfiguration();
    resetDocuments();
    resetEvents();
    resetFileSystem();
    resetFolders();
    resetLanguages();
    resetWindow();
    resetWebviews();
    resetWorkspace();
}
