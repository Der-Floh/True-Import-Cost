import * as vscode from 'vscode';

import { resolveSettingPath } from './metadataLocator';
import { IN_PROCESS_READER } from './metadataReader';
import { withPackageVersions } from '../../core/adapters/packageVersions';
import { BuildGraph } from '../../core/graph/buildGraph';
import { adoptPrecomputed } from '../../core/graph/precomputed';
import { isAbsolutePath } from '../../core/paths';

import type { MetadataSource } from './metadataLocator';
import type { MetadataReader } from './metadataReader';
import type { BuildSnapshot } from '../../core/schema/snapshot';

export interface LoadedTarget {
    readonly key: string;
    readonly id: string;
    readonly source: MetadataSource;
    readonly snapshot: BuildSnapshot;
    readonly graph: BuildGraph;
    readonly baseUri: vscode.Uri;
    readonly adapter: string;
    readonly fingerprint: string;
    readonly loadedAt: number;
}

export type LoadResult =
    | { readonly ok: true; readonly target: LoadedTarget }
    | { readonly ok: false; readonly error: string };

const MAX_ROOT_SAMPLES = 6;

function fileNameOf(uri: vscode.Uri): string {
    return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}

function parentOf(uri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(uri, '..');
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

function rootSamples(snapshot: BuildSnapshot): string[] {
    const candidates = snapshot.modules.filter(module => module.virtual !== true && !isAbsolutePath(module.path) && module.contributions.length > 0);
    const firstParty = candidates.filter(module => module.packageName === undefined);
    return [...firstParty, ...candidates.filter(module => module.packageName !== undefined)]
        .slice(0, MAX_ROOT_SAMPLES)
        .map(module => module.path);
}

async function probeBase(source: MetadataSource, snapshot: BuildSnapshot): Promise<vscode.Uri> {
    const samples = rootSamples(snapshot);
    if (samples.length === 0) {
        return source.folder.uri;
    }
    const folderPath = source.folder.uri.path.replace(/\/$/, '');
    let candidate = parentOf(source.uri);
    for (let depth = 0; depth < 32; depth++) {
        for (const sample of samples) {
            if (await exists(vscode.Uri.joinPath(candidate, sample))) {
                return candidate;
            }
        }
        if (candidate.path.replace(/\/$/, '') === folderPath || !candidate.path.startsWith(`${folderPath}/`)) {
            break;
        }
        candidate = parentOf(candidate);
    }
    return source.folder.uri;
}

async function resolveBase(source: MetadataSource, snapshot: BuildSnapshot, adapter: string): Promise<vscode.Uri> {
    if (source.setting?.root !== undefined) {
        return resolveSettingPath(source.folder, source.setting.root);
    }
    if (adapter === 'snapshot') {
        return isAbsolutePath(snapshot.root) ? vscode.Uri.file(snapshot.root) : vscode.Uri.joinPath(parentOf(source.uri), snapshot.root);
    }
    return probeBase(source, snapshot);
}

async function readPackageVersion(base: vscode.Uri, packageRoot: string): Promise<string | undefined> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(base, packageRoot, 'package.json'));
    const manifest: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof manifest === 'object' && manifest !== null && 'version' in manifest && typeof manifest.version === 'string'
        ? manifest.version
        : undefined;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function loadTarget(source: MetadataSource, reader: MetadataReader = IN_PROCESS_READER): Promise<LoadResult> {
    let stat: vscode.FileStat;
    try {
        stat = await vscode.workspace.fs.stat(source.uri);
    } catch {
        return { ok: false, error: 'the file does not exist' };
    }
    if (stat.size > source.maxBytes) {
        return { ok: false, error: `the file is ${Math.ceil(stat.size / 1024 / 1024)} MB, above the ${Math.round(source.maxBytes / 1024 / 1024)} MB limit set by trueImportCost.maxMetadataSizeMB` };
    }

    let bytes: Uint8Array;
    try {
        bytes = await vscode.workspace.fs.readFile(source.uri);
    } catch (error: unknown) {
        return { ok: false, error: `the file could not be read: ${describe(error)}` };
    }
    if (bytes.byteLength > source.maxBytes) {
        return { ok: false, error: 'the file grew past the size limit while it was read' };
    }

    const read = await reader.read(bytes, {
        fileName: fileNameOf(source.uri),
        modifiedAt: stat.mtime,
        ...(source.setting?.id === undefined ? {} : { targetId: source.setting.id }),
    });
    if (!read.ok) {
        return { ok: false, error: read.error };
    }

    const baseUri = await resolveBase(source, read.snapshot, read.adapter);
    const snapshot = await withPackageVersions(read.snapshot, root => readPackageVersion(baseUri, root));
    const graph = new BuildGraph(snapshot);
    if (read.precomputed) {
        adoptPrecomputed(graph, read.precomputed);
    }
    return {
        ok: true,
        target: {
            key: source.uri.toString(),
            id: source.setting?.id ?? snapshot.target,
            source,
            snapshot,
            graph,
            baseUri,
            adapter: read.adapter,
            fingerprint: read.fingerprint,
            loadedAt: Date.now(),
        },
    };
}
