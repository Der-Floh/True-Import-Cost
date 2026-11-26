import * as vscode from 'vscode';

import { BuildGraph } from '../../core/graph/buildGraph';
import { MEASURE_ENV, MEASURE_VERSION, measureReportFile, parseMeasureReport } from '../../core/measureProtocol';
import { parseSnapshot } from '../../core/schema/validate';

import type { BuildOutcome, BuildRunner } from './buildRunner';
import type { SourceEdit } from '../../core/measureProtocol';
import type { BuildSnapshot } from '../../core/schema/snapshot';

export class MeasureFailure extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'MeasureFailure';
    }
}

export class MeasureCancelled extends Error {
    public constructor() {
        super('The measurement was cancelled.');
        this.name = 'MeasureCancelled';
    }
}

export interface MeasuredBuildRequest {
    readonly workspace: vscode.Uri;
    readonly name: string;
    readonly command: string;
    readonly cwd: string;
    readonly targetName: string;
    readonly preferredFile: string;
    readonly edits: readonly SourceEdit[];
    readonly timeoutMs: number;
    readonly maxBytes: number;
    readonly signal: AbortSignal;
    readonly onOutput: (line: string) => void;
}

interface FoundSnapshot {
    readonly file: vscode.Uri;
    readonly snapshot: BuildSnapshot;
}

export function newMeasureWorkspace(base: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(base, crypto.randomUUID());
}

export async function removeMeasureWorkspace(workspace: vscode.Uri): Promise<void> {
    await Promise.resolve(vscode.workspace.fs.delete(workspace, { recursive: true, useTrash: false })).catch(() => undefined);
}

function assertSucceeded(outcome: BuildOutcome, request: MeasuredBuildRequest): void {
    switch (outcome.status) {
        case 'succeeded':
            return;
        case 'cancelled':
            throw new MeasureCancelled();
        case 'timed-out':
            throw new MeasureFailure(`"${request.command}" did not finish within ${Math.round(request.timeoutMs / 1000)} seconds. Raise trueImportCost.measure.timeoutSeconds if the build needs longer.`);
        case 'failed':
            throw new MeasureFailure(`"${request.command}" failed (${outcome.detail}). The log has its output.`);
    }
}

async function readJsonFile(file: vscode.Uri, maxBytes: number): Promise<unknown> {
    const info = await vscode.workspace.fs.stat(file);
    if (info.size > maxBytes) {
        throw new MeasureFailure(`${file.path.slice(file.path.lastIndexOf('/') + 1)} is larger than trueImportCost.maxMetadataSizeMB allows.`);
    }
    return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file))) as unknown;
}

async function snapshotNames(outDir: vscode.Uri, preferred: string): Promise<string[]> {
    const entries = await Promise.resolve(vscode.workspace.fs.readDirectory(outDir)).catch((): [string, vscode.FileType][] => []);
    return entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json') && !name.endsWith('.edits.json'))
        .map(([name]) => name)
        .sort((a, b) => Number(b === preferred) - Number(a === preferred) || a.localeCompare(b));
}

async function findSnapshot(outDir: vscode.Uri, request: MeasuredBuildRequest): Promise<FoundSnapshot> {
    for (const name of await snapshotNames(outDir, request.preferredFile)) {
        const file = vscode.Uri.joinPath(outDir, name);
        const parsed = parseSnapshot(await readJsonFile(file, request.maxBytes).catch((): unknown => undefined));
        if (parsed.ok && parsed.snapshot.target === request.targetName) {
            return { file, snapshot: parsed.snapshot };
        }
    }
    throw new MeasureFailure(`"${request.command}" finished, but no True Import Cost snapshot of "${request.targetName}" came out of it. Check that this command builds the target with the True Import Cost plugin, or set trueImportCost.measure.command.`);
}

function sameFile(a: string, b: string): boolean {
    const [left, right] = [vscode.Uri.file(a).toString(), vscode.Uri.file(b).toString()];
    return left === right || (process.platform === 'win32' && left.toLowerCase() === right.toLowerCase());
}

async function assertEditsApplied(snapshotFile: vscode.Uri, request: MeasuredBuildRequest): Promise<void> {
    if (request.edits.length === 0) {
        return;
    }
    const reportFile = vscode.Uri.file(measureReportFile(snapshotFile.fsPath));
    const report = parseMeasureReport(await readJsonFile(reportFile, request.maxBytes).catch((): unknown => undefined));
    const missing = request.edits.filter(edit => !report?.applied.some(file => sameFile(file, edit.file)));
    if (missing.length > 0) {
        const files = missing.map(edit => vscode.Uri.file(edit.file).path.replace(/^.*\//, '')).join(', ');
        throw new MeasureFailure(`The build of "${request.targetName}" did not load ${files} through the True Import Cost plugin, so it could not be built without the import.`);
    }
}

export async function measuredBuild(runBuild: BuildRunner, request: MeasuredBuildRequest): Promise<BuildGraph> {
    const outDir = vscode.Uri.joinPath(request.workspace, request.name);
    const requestFile = vscode.Uri.joinPath(request.workspace, `${request.name}.request.json`);
    await vscode.workspace.fs.createDirectory(request.workspace);
    await vscode.workspace.fs.writeFile(requestFile, new TextEncoder().encode(JSON.stringify({ version: MEASURE_VERSION, outDir: outDir.fsPath, edits: request.edits })));
    const outcome = await runBuild({
        command: request.command,
        cwd: request.cwd,
        env: { [MEASURE_ENV]: requestFile.fsPath },
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        onOutput: request.onOutput,
    });
    assertSucceeded(outcome, request);
    const { file, snapshot } = await findSnapshot(outDir, request);
    await assertEditsApplied(file, request);
    return new BuildGraph(snapshot);
}
