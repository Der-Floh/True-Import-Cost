import path from 'node:path';

import { CliError } from './environment';
import { parseJson, readTextFile } from './files';
import { isRecord } from '../core/adapters/adapter';
import { withPackageVersions } from '../core/adapters/packageVersions';
import { normalizeMetadata } from '../core/adapters/registry';
import { BuildGraph } from '../core/graph/buildGraph';
import { isAbsolutePath } from '../core/paths';

import type { CliEnvironment } from './environment';
import type { BuildSnapshot } from '../core/schema/snapshot';

export interface LoadedBuild {
    readonly file: string;
    readonly graph: BuildGraph;
}

const MAX_ROOT_SAMPLES = 6;
const MAX_PROBE_DEPTH = 32;
const MAX_MANIFEST_MB = 1;

function targetFromFileName(file: string): string {
    const name = path.basename(file).replace(/\.json$/i, '');
    return name === '' ? 'build' : name;
}

function rootSamples(snapshot: BuildSnapshot): string[] {
    const candidates = snapshot.modules.filter(module => module.virtual !== true && !isAbsolutePath(module.path) && module.contributions.length > 0);
    const firstParty = candidates.filter(module => module.packageName === undefined);
    return [...firstParty, ...candidates.filter(module => module.packageName !== undefined)]
        .slice(0, MAX_ROOT_SAMPLES)
        .map(module => module.path);
}

async function containsAny(environment: CliEnvironment, directory: string, samples: readonly string[]): Promise<boolean> {
    for (const sample of samples) {
        if (await environment.files.info(path.resolve(directory, sample)) !== undefined) {
            return true;
        }
    }
    return false;
}

async function probeBuildDirectory(environment: CliEnvironment, metadataFile: string, snapshot: BuildSnapshot): Promise<string> {
    const samples = rootSamples(snapshot);
    let candidate = path.dirname(metadataFile);
    for (let depth = 0; samples.length > 0 && depth < MAX_PROBE_DEPTH; depth++) {
        if (await containsAny(environment, candidate, samples)) {
            return candidate;
        }
        const parent = path.dirname(candidate);
        if (parent === candidate) {
            break;
        }
        candidate = parent;
    }
    return environment.cwd;
}

function buildDirectory(environment: CliEnvironment, metadataFile: string, snapshot: BuildSnapshot, adapter: string): Promise<string> {
    if (adapter === 'snapshot') {
        return Promise.resolve(path.resolve(path.dirname(metadataFile), snapshot.root));
    }
    return probeBuildDirectory(environment, metadataFile, snapshot);
}

async function readPackageVersion(environment: CliEnvironment, directory: string, packageRoot: string): Promise<string | undefined> {
    const { text } = await readTextFile(environment, path.resolve(directory, packageRoot, 'package.json'), MAX_MANIFEST_MB);
    const manifest: unknown = JSON.parse(text);
    return isRecord(manifest) && typeof manifest.version === 'string' ? manifest.version : undefined;
}

export async function loadBuild(environment: CliEnvironment, file: string, maxSizeMB: number): Promise<LoadedBuild> {
    const { text, modifiedAt } = await readTextFile(environment, file, maxSizeMB);
    const value = parseJson(file, text);
    const metadataFile = path.resolve(environment.cwd, file);
    const normalized = await normalizeMetadata(value, { target: targetFromFileName(metadataFile), createdAt: modifiedAt });
    if (!normalized.ok) {
        throw new CliError(`${file}: ${normalized.error}`);
    }
    const directory = await buildDirectory(environment, metadataFile, normalized.snapshot, normalized.adapter);
    const snapshot = await withPackageVersions(normalized.snapshot, root => readPackageVersion(environment, directory, root));
    return { file, graph: new BuildGraph(snapshot) };
}
