import * as vscode from 'vscode';

import { projectDirectoryOf } from './buildCommand';
import { confirmRun, describeFolder } from './consent';
import { newMeasureWorkspace, removeMeasureWorkspace } from './measuredBuild';
import { DISPLAY_NAME } from '../constants';
import { formatBytes } from '../../core/format';
import { parseBareSpecifier } from '../../core/packages';
import { parseStandaloneResult, platformOf, STANDALONE_ENV, STANDALONE_VERSION } from '../../core/standaloneProtocol';
import { Logger } from '../services/logger';

import type { BuildRunner } from './buildRunner';
import type { ConsentRequest } from './consent';
import type { StandaloneNames, StandalonePlatform, StandaloneSize } from '../../core/standaloneProtocol';
import type { SourceImport } from '../../parser';
import type { ExtensionStorage } from '../services/extensionStorage';
import type { ImportCostService } from '../services/importCosts';
import type { LoadedTarget } from '../services/metadataLoader';
import type { SnapshotStore } from '../services/snapshotStore';

export interface StandaloneArguments {
    readonly target: string;
    readonly specifier: string;
    readonly names: StandaloneNames;
}

export interface StandaloneMeasurement {
    readonly key: string;
    readonly packageName: string;
    readonly versions: string;
    readonly names: StandaloneNames;
    readonly platform: StandalonePlatform;
    readonly bundler: string;
    readonly whole: StandaloneSize;
    readonly imported?: StandaloneSize;
    readonly measuredAt: number;
}

export interface StandaloneDependencies {
    readonly store: SnapshotStore;
    readonly service: ImportCostService;
    readonly sizes: StandaloneSizes;
    readonly storage: ExtensionStorage;
    readonly state: vscode.Memento;
    readonly extensionUri: vscode.Uri;
    readonly runBuild: BuildRunner;
}

const AREA = 'standalone';

const MAX_SIZES = 300;

const TIMEOUT_MS = 120_000;

function namesKey(names: StandaloneNames): string {
    return names === 'all' ? '*' : [...new Set(names)].sort().join(',');
}

function versionsOf(target: LoadedTarget, packageName: string): string {
    const versions = [...target.graph.packages().values()].filter(instance => instance.name === packageName).map(instance => instance.version ?? '?');
    return [...new Set(versions)].sort().join(',');
}

export function standaloneKey(target: LoadedTarget, specifier: string, names: StandaloneNames): string | undefined {
    const packageName = parseBareSpecifier(specifier)?.packageName;
    return packageName === undefined ? undefined : [specifier, versionsOf(target, packageName), platformOf(target.snapshot), namesKey(names)].join('|');
}

export function standaloneArgumentsFor(target: LoadedTarget, source: SourceImport): StandaloneArguments | undefined {
    if (parseBareSpecifier(source.specifier) === undefined || source.typeOnly) {
        return undefined;
    }
    const named = source.kind === 'named' || source.kind === 'default'
        ? source.bindings.filter(binding => !binding.typeOnly).map(binding => binding.imported)
        : [];
    return { target: target.key, specifier: source.specifier, names: named.length > 0 ? named : 'all' };
}

function isStandaloneArguments(value: unknown): value is StandaloneArguments {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const args = value as Partial<Record<keyof StandaloneArguments, unknown>>;
    return typeof args.target === 'string' && typeof args.specifier === 'string'
        && (args.names === 'all' || (Array.isArray(args.names) && args.names.length <= 100 && args.names.every(name => typeof name === 'string')));
}

function parseMeasurement(value: unknown): StandaloneMeasurement | undefined {
    const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
    const result = parseStandaloneResult({ ok: true, bundler: record.bundler, whole: record.whole, imported: record.imported });
    const names = record.names === 'all' || (Array.isArray(record.names) && record.names.every(name => typeof name === 'string')) ? record.names as StandaloneNames : undefined;
    if (!result?.ok || names === undefined || typeof record.key !== 'string' || typeof record.packageName !== 'string' || typeof record.versions !== 'string'
        || (record.platform !== 'browser' && record.platform !== 'node') || typeof record.measuredAt !== 'number') {
        return undefined;
    }
    return {
        key: record.key,
        packageName: record.packageName,
        versions: record.versions,
        names,
        platform: record.platform,
        bundler: result.bundler,
        whole: result.whole,
        ...(result.imported === undefined ? {} : { imported: result.imported }),
        measuredAt: record.measuredAt,
    };
}

export class StandaloneSizes implements vscode.Disposable {
    private readonly storage: ExtensionStorage;
    private loading: Promise<Map<string, StandaloneMeasurement>> | undefined;
    private queue: Promise<void> = Promise.resolve();
    private readonly changed = new vscode.EventEmitter<void>();

    public readonly onDidChange: vscode.Event<void> = this.changed.event;

    public constructor(storage: ExtensionStorage) {
        this.storage = storage;
    }

    public async find(key: string): Promise<StandaloneMeasurement | undefined> {
        return (await this.load()).get(key);
    }

    public record(measurement: StandaloneMeasurement): Promise<void> {
        return this.enqueue(async () => {
            const sizes = await this.load();
            sizes.delete(measurement.key);
            sizes.set(measurement.key, measurement);
            for (const key of [...sizes.keys()].slice(0, Math.max(0, sizes.size - MAX_SIZES))) {
                sizes.delete(key);
            }
            await this.storage.writeJson(this.file(), { version: 1, sizes: [...sizes.values()] });
            this.changed.fire();
        });
    }

    public clear(): Promise<void> {
        return this.enqueue(async () => {
            this.loading = Promise.resolve(new Map());
            await this.storage.remove(this.file());
            this.changed.fire();
        });
    }

    public dispose(): void {
        this.changed.dispose();
    }

    private file(): vscode.Uri {
        return this.storage.fileFor(AREA, 'sizes');
    }

    private load(): Promise<Map<string, StandaloneMeasurement>> {
        this.loading ??= this.storage.readJson(this.file()).then((value) => {
            const list = typeof value === 'object' && value !== null ? (value as { sizes?: unknown }).sizes : undefined;
            const sizes = Array.isArray(list) ? list.slice(-MAX_SIZES).map(parseMeasurement) : [];
            return new Map(sizes.flatMap(size => (size === undefined ? [] : [[size.key, size] as const])));
        });
        return this.loading;
    }

    private enqueue(work: () => Promise<void>): Promise<void> {
        const next = this.queue.then(work, work);
        this.queue = next.catch(() => undefined);
        return next;
    }
}

function quoted(value: string): string {
    return process.platform === 'win32' ? `"${value}"` : `'${value.replace(/'/g, "'\\''")}'`;
}

function describeNames(specifier: string, names: StandaloneNames): string {
    return names === 'all' ? specifier : `{ ${[...new Set(names)].join(', ')} } from ${specifier}`;
}

function resultText(measurement: StandaloneMeasurement, specifier: string): string {
    const { whole, imported } = measurement;
    const wholeText = `${formatBytes(whole.bytes)} minified, ${formatBytes(whole.gzipBytes)} gzipped`;
    const subject = `Bundled by itself with ${measurement.bundler} for ${measurement.platform === 'node' ? 'Node.js' : 'browsers'}`;
    return imported === undefined
        ? `${subject}, ${specifier} is ${wholeText}.`
        : `${subject}, ${describeNames(specifier, measurement.names)} is ${formatBytes(imported.bytes)} minified, ${formatBytes(imported.gzipBytes)} gzipped; the whole package is ${wholeText}.`;
}

function consentRequest(specifier: string, cwd: vscode.Uri): ConsentRequest {
    return {
        kind: 'bundler',
        command: 'bundle a package by itself',
        cwd,
        message: `Bundle ${specifier} by itself to measure its standalone size?`,
        detail: [
            `True Import Cost bundles the package with the esbuild or Rolldown installed in ${describeFolder(cwd)}, in a process of its own, and measures the minified result.`,
            'The bundler runs from your project\'s node_modules. Your build configuration is not used, and nothing is written to your project.',
        ].join('\n\n'),
    };
}

export class StandaloneMeasurer implements vscode.Disposable {
    private readonly dependencies: StandaloneDependencies;
    private readonly stopped = new AbortController();
    private running = false;

    public constructor(dependencies: StandaloneDependencies) {
        this.dependencies = dependencies;
    }

    public dispose(): void {
        this.stopped.abort();
    }

    public async measure(argument?: unknown): Promise<void> {
        const args = isStandaloneArguments(argument) ? argument : await this.fromActiveEditor();
        if (!args) {
            void vscode.window.showInformationMessage('Put the cursor on the import of a package to measure its standalone size.');
            return;
        }
        await this.measureArguments(args);
    }

    private async fromActiveEditor(): Promise<StandaloneArguments | undefined> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        const cancellation = new vscode.CancellationTokenSource();
        try {
            const costs = await this.dependencies.service.costsFor(editor.document, cancellation.token);
            const offset = editor.document.offsetAt(editor.selection.active);
            const entry = costs?.entries.find(candidate => offset >= candidate.source.range.start && offset <= candidate.source.range.end);
            return costs && entry ? standaloneArgumentsFor(costs.target, entry.source) : undefined;
        } finally {
            cancellation.dispose();
        }
    }

    private async measureArguments(argument: StandaloneArguments): Promise<void> {
        const target = this.dependencies.store.target(argument.target);
        const key = target === undefined ? undefined : standaloneKey(target, argument.specifier, argument.names);
        if (!target || key === undefined) {
            void vscode.window.showWarningMessage('That build target is no longer loaded, or the import is not a package.');
            return;
        }
        if (this.running) {
            void vscode.window.showInformationMessage('True Import Cost is already measuring a standalone size.');
            return;
        }
        this.running = true;
        try {
            const { directory } = await projectDirectoryOf(target);
            if (await confirmRun(this.dependencies.state, consentRequest(argument.specifier, directory))) {
                await this.run(target, argument, key, directory);
            }
        } finally {
            this.running = false;
        }
    }

    private async run(target: LoadedTarget, args: StandaloneArguments, key: string, directory: vscode.Uri): Promise<void> {
        const { storage, extensionUri, runBuild, sizes } = this.dependencies;
        const workspace = newMeasureWorkspace(storage.areaFor('standalone-runs'));
        const platform = platformOf(target.snapshot);
        try {
            const jobFile = vscode.Uri.joinPath(workspace, 'job.json');
            const resultFile = vscode.Uri.joinPath(workspace, 'result.json');
            await vscode.workspace.fs.createDirectory(workspace);
            const job = { version: STANDALONE_VERSION, cwd: directory.fsPath, specifier: args.specifier, names: args.names, platform, resultFile: resultFile.fsPath };
            await vscode.workspace.fs.writeFile(jobFile, new TextEncoder().encode(JSON.stringify(job)));
            const driver = vscode.Uri.joinPath(extensionUri, 'out', 'standalone.js').fsPath;
            const outcome = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Bundling ${args.specifier} by itself` }, () => runBuild({
                command: `${quoted(process.execPath)} ${quoted(driver)}`,
                cwd: directory.fsPath,
                env: { [STANDALONE_ENV]: jobFile.fsPath, ELECTRON_RUN_AS_NODE: '1' },
                timeoutMs: TIMEOUT_MS,
                signal: this.stopped.signal,
                onOutput: line => Logger.info(`[standalone] ${line}`),
            }));
            const result = outcome.status === 'succeeded'
                ? parseStandaloneResult(JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(resultFile))))
                : { ok: false as const, error: outcome.status === 'failed' ? outcome.detail : outcome.status };
            if (!result?.ok) {
                void vscode.window.showErrorMessage(`${DISPLAY_NAME}: ${args.specifier} could not be bundled by itself: ${result?.error ?? 'the bundler wrote no result'}.`);
                return;
            }
            const packageName = parseBareSpecifier(args.specifier)?.packageName ?? args.specifier;
            const measurement: StandaloneMeasurement = {
                key,
                packageName,
                versions: versionsOf(target, packageName),
                names: args.names,
                platform,
                bundler: result.bundler,
                whole: result.whole,
                ...(result.imported === undefined ? {} : { imported: result.imported }),
                measuredAt: Date.now(),
            };
            await sizes.record(measurement);
            void vscode.window.showInformationMessage(resultText(measurement, args.specifier));
        } finally {
            await removeMeasureWorkspace(workspace);
        }
    }
}
