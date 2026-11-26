import * as vscode from 'vscode';

import { buildCommandFor, isMeasurable } from './buildCommand';
import { confirmRun } from './consent';
import { MeasureCancelled, measuredBuild, newMeasureWorkspace, removeMeasureWorkspace } from './measuredBuild';
import { DISPLAY_NAME } from '../constants';
import { formatBytes } from '../../core/format';
import { measureImport, savingsOf } from '../../core/measurement';
import { Logger } from '../services/logger';
import { loadParser } from '../services/parserHost';
import { documentPathIn } from '../services/snapshotStore';

import type { BuildCommand } from './buildCommand';
import type { BuildRunner } from './buildRunner';
import type { ConsentRequest } from './consent';
import type { MeasuredBuildRequest } from './measuredBuild';
import type { SourceEdit } from '../../core/measureProtocol';
import type { ImportMeasurement } from '../../core/measurement';
import type { SourceImport } from '../../parser';
import type { ExtensionStorage } from '../services/extensionStorage';
import type { ImportCostService } from '../services/importCosts';
import type { MeasurementStore } from '../services/measurementStore';
import type { LoadedTarget } from '../services/metadataLoader';
import type { Settings } from '../services/settings';
import type { SnapshotStore } from '../services/snapshotStore';

export interface MeasureArguments {
    readonly target: string;
    readonly uri: string;
    readonly specifier: string;
    readonly start: number;
}

export interface MeasureDependencies {
    readonly store: SnapshotStore;
    readonly service: ImportCostService;
    readonly measurements: MeasurementStore;
    readonly storage: ExtensionStorage;
    readonly state: vscode.Memento;
    readonly settings: () => Settings;
    readonly runBuild: BuildRunner;
}

interface PlannedMeasurement {
    readonly target: LoadedTarget;
    readonly importer: string;
    readonly specifier: string;
    readonly edit: SourceEdit;
    readonly command: BuildCommand;
}

const BYTE_ORDER_MARK = '﻿';

const SAVE_AND_MEASURE = 'Save and Measure';

const OPEN_SETTINGS = 'Open Settings';

const SHOW_LOG = 'Show Log';

export function isMeasureArguments(value: unknown): value is MeasureArguments {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const args = value as Partial<Record<keyof MeasureArguments, unknown>>;
    return typeof args.target === 'string' && typeof args.uri === 'string' && typeof args.specifier === 'string'
        && typeof args.start === 'number' && Number.isInteger(args.start) && args.start >= 0;
}

export function measureArgumentsFor(target: LoadedTarget, uri: vscode.Uri, source: SourceImport): MeasureArguments {
    return { target: target.key, uri: uri.toString(), specifier: source.specifier, start: source.range.start };
}

function openDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
}

function fileName(uri: vscode.Uri): string {
    return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}

function unmeasurableReason(source: SourceImport): string {
    if (source.typeOnly) {
        return `${source.specifier} is imported for its types only, which no build keeps.`;
    }
    if (source.kind === 'export-all') {
        return `export * from '${source.specifier}' has no names True Import Cost could stand in for, so it cannot be taken out.`;
    }
    return `True Import Cost cannot take this import of ${source.specifier} out of the file and keep it building.`;
}

export class ImportMeasurer implements vscode.Disposable {
    private readonly dependencies: MeasureDependencies;
    private readonly stopped = new AbortController();
    private running = false;

    public constructor(dependencies: MeasureDependencies) {
        this.dependencies = dependencies;
    }

    public get isRunning(): boolean {
        return this.running;
    }

    public dispose(): void {
        this.stopped.abort();
    }

    public async measure(argument?: unknown): Promise<void> {
        if (this.running) {
            void vscode.window.showInformationMessage('True Import Cost is already measuring an import.');
            return;
        }
        const args = isMeasureArguments(argument) ? argument : await this.fromActiveEditor();
        if (!args) {
            void vscode.window.showInformationMessage('Put the cursor on an import to measure what building without it saves.');
            return;
        }
        this.running = true;
        try {
            const planned = await this.plan(args);
            if (!planned || !(await confirmRun(this.dependencies.state, consentRequest(planned)))) {
                return;
            }
            const measurement = await this.run(planned);
            await this.dependencies.measurements.record(planned.target.key, measurement);
            void vscode.window.showInformationMessage(resultText(planned.target, measurement));
        } catch (error: unknown) {
            if (!(error instanceof MeasureCancelled)) {
                reportFailure(error);
            }
        } finally {
            this.running = false;
        }
    }

    private async fromActiveEditor(): Promise<MeasureArguments | undefined> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        const cancellation = new vscode.CancellationTokenSource();
        try {
            const costs = await this.dependencies.service.costsFor(editor.document, cancellation.token);
            const offset = editor.document.offsetAt(editor.selection.active);
            const entry = costs?.entries.find(candidate => offset >= candidate.source.range.start && offset <= candidate.source.range.end);
            return costs && entry ? measureArgumentsFor(costs.target, editor.document.uri, entry.source) : undefined;
        } finally {
            cancellation.dispose();
        }
    }

    private async plan(args: MeasureArguments): Promise<PlannedMeasurement | undefined> {
        const target = this.dependencies.store.target(args.target);
        if (!target) {
            void vscode.window.showWarningMessage('That build target is no longer loaded. Refresh and try again.');
            return undefined;
        }
        if (!isMeasurable(target)) {
            void vscode.window.showInformationMessage(`Measuring needs the True Import Cost plugin in the build of "${target.id}"; its metadata comes from ${target.adapter === 'snapshot' ? `a ${target.snapshot.bundler.name} build` : `a raw ${target.adapter} file`}.`);
            return undefined;
        }
        const uri = vscode.Uri.parse(args.uri);
        if (uri.scheme !== 'file' || !(await ensureSaved(uri))) {
            return undefined;
        }
        const edit = await planEdit(target, uri, args);
        if (typeof edit === 'string') {
            void vscode.window.showInformationMessage(edit);
            return undefined;
        }
        const command = await buildCommandFor(target, this.dependencies.settings().measureCommands);
        if (!command) {
            void vscode.window.showWarningMessage(`True Import Cost does not know how to build "${target.id}". Set trueImportCost.measure.command to the command that builds it.`, OPEN_SETTINGS)
                .then(answer => (answer === OPEN_SETTINGS ? vscode.commands.executeCommand('workbench.action.openSettings', 'trueImportCost.measure.command') : undefined));
            return undefined;
        }
        return { target, importer: edit.importer, specifier: args.specifier, edit: edit.edit, command };
    }

    private async run(planned: PlannedMeasurement): Promise<ImportMeasurement> {
        const { target, command } = planned;
        const workspace = newMeasureWorkspace(this.dependencies.storage.areaFor('measure'));
        try {
            return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Measuring ${planned.specifier}`, cancellable: true }, async (progress, token) => {
                const abort = new AbortController();
                const listener = token.onCancellationRequested(() => abort.abort());
                const onStopped = (): void => abort.abort();
                this.stopped.signal.addEventListener('abort', onStopped, { once: true });
                const base: Omit<MeasuredBuildRequest, 'name' | 'edits'> = {
                    workspace,
                    command: command.command,
                    cwd: command.cwd.fsPath,
                    targetName: target.snapshot.target,
                    preferredFile: fileName(target.source.uri),
                    timeoutMs: this.dependencies.settings().measureTimeoutSeconds * 1000,
                    maxBytes: target.source.maxBytes,
                    signal: abort.signal,
                    onOutput: line => Logger.info(`[build] ${line}`),
                };
                try {
                    Logger.info(`Measuring ${planned.specifier} in ${planned.importer}: running "${command.command}" in ${command.cwd.fsPath} twice.`);
                    progress.report({ message: `building "${target.id}" as it is (1 of 2)` });
                    const withImport = await measuredBuild(this.dependencies.runBuild, { ...base, name: 'with', edits: [] });
                    progress.report({ message: 'building it without the import (2 of 2)', increment: 50 });
                    const withoutImport = await measuredBuild(this.dependencies.runBuild, { ...base, name: 'without', edits: [planned.edit] });
                    return measureImport(withImport, withoutImport, { method: 'built-without', importer: planned.importer, specifier: planned.specifier, measuredAt: Date.now() });
                } finally {
                    listener.dispose();
                    this.stopped.signal.removeEventListener('abort', onStopped);
                }
            });
        } finally {
            await removeMeasureWorkspace(workspace);
        }
    }
}

async function ensureSaved(uri: vscode.Uri): Promise<boolean> {
    const document = openDocument(uri);
    if (!document?.isDirty) {
        return true;
    }
    const answer = await vscode.window.showWarningMessage(`Measuring builds ${fileName(uri)} as it is saved, and it has unsaved changes.`, { modal: true }, SAVE_AND_MEASURE);
    return answer === SAVE_AND_MEASURE && await document.save();
}

async function planEdit(target: LoadedTarget, uri: vscode.Uri, args: MeasureArguments): Promise<{ readonly importer: string; readonly edit: SourceEdit } | string> {
    const importer = documentPathIn(target.baseUri, uri);
    if (importer === undefined || target.graph.modulesAt(importer).length === 0) {
        return `${vscode.workspace.asRelativePath(uri)} is not part of build target "${target.id}".`;
    }
    const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    const text = raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(BYTE_ORDER_MARK.length) : raw;
    const parser = await loadParser();
    const languageId = openDocument(uri)?.languageId ?? '';
    const source = parser.analyzeDocument(languageId, uri.fsPath, text, { usage: false }).imports
        .filter(candidate => candidate.specifier === args.specifier)
        .sort((a, b) => Math.abs(a.range.start - args.start) - Math.abs(b.range.start - args.start))[0];
    if (!source) {
        return `The saved ${fileName(uri)} no longer imports ${args.specifier}.`;
    }
    const removal = parser.planRemoval(text, source);
    return removal === undefined ? unmeasurableReason(source) : { importer, edit: { file: uri.fsPath, ...removal } };
}

function consentRequest(planned: PlannedMeasurement): ConsentRequest {
    const { target, command } = planned;
    return {
        kind: 'build',
        command: command.command,
        cwd: command.cwd,
        message: `Measure ${planned.specifier} by building "${target.id}" twice with "${command.command}"?`,
        detail: [
            `True Import Cost runs the command in ${vscode.workspace.asRelativePath(command.cwd)}: once as your code is, once with this import taken out of ${planned.importer}, and compares the two builds.`,
            'Your build configuration and its plugins run as they do when you build yourself. The True Import Cost plugin keeps the build from writing its output and puts its reports in a temporary folder; anything else the command does still happens.',
        ].join('\n\n'),
    };
}

function resultText(target: LoadedTarget, measurement: ImportMeasurement): string {
    const saved = savingsOf(measurement);
    const subject = `Building "${target.id}" without ${measurement.specifier} in ${measurement.importer}`;
    if (saved.total === 0) {
        return `${subject} leaves it the same size.`;
    }
    if (saved.total < 0) {
        return `${subject} makes it ${formatBytes(-saved.total)} larger.`;
    }
    if (saved.initial >= saved.total) {
        return `${subject} saves ${formatBytes(saved.total)}, all of it from the initial load.`;
    }
    return saved.initial > 0
        ? `${subject} saves ${formatBytes(saved.total)}, ${formatBytes(saved.initial)} of it from the initial load.`
        : `${subject} saves ${formatBytes(saved.total)}, none of it from the initial load.`;
}

function reportFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    Logger.error(`Measuring failed: ${message}`);
    void vscode.window.showErrorMessage(`${DISPLAY_NAME}: ${message}`, SHOW_LOG).then((answer) => {
        if (answer === SHOW_LOG) {
            Logger.show();
        }
    });
}
