import * as vscode from 'vscode';

import type { LoadedTarget } from '../services/metadataLoader';

export const ANY_TARGET_COMMAND = '*';

const MEASURABLE_BUNDLERS: ReadonlySet<string> = new Set(['esbuild', 'vite', 'webpack', 'rspack']);

const MAX_PARENT_STEPS = 20;

export type CommandSource = 'setting' | 'vite' | 'build script';

export interface BuildCommand {
    readonly command: string;
    readonly cwd: vscode.Uri;
    readonly source: CommandSource;
}

interface ProjectDirectory {
    readonly directory: vscode.Uri;
    readonly manifest?: Readonly<Record<string, unknown>>;
}

export function isMeasurable(target: LoadedTarget): boolean {
    return target.adapter === 'snapshot' && MEASURABLE_BUNDLERS.has(target.snapshot.bundler.name);
}

async function readManifest(uri: vscode.Uri): Promise<Readonly<Record<string, unknown>> | undefined> {
    try {
        const value: unknown = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    } catch {
        return undefined;
    }
}

function isWithin(directory: vscode.Uri, folder: vscode.Uri): boolean {
    return directory.path === folder.path || directory.path.startsWith(`${folder.path.replace(/\/$/, '')}/`);
}

export async function projectDirectoryOf(target: LoadedTarget): Promise<ProjectDirectory> {
    const folder = target.source.folder.uri;
    let directory = target.baseUri;
    for (let step = 0; step < MAX_PARENT_STEPS && isWithin(directory, folder); step++) {
        const manifest = await readManifest(vscode.Uri.joinPath(directory, 'package.json'));
        if (manifest) {
            return { directory, manifest };
        }
        const parent = vscode.Uri.joinPath(directory, '..');
        if (parent.path === directory.path) {
            break;
        }
        directory = parent;
    }
    return { directory: target.baseUri };
}

function hasBuildScript(manifest: Readonly<Record<string, unknown>> | undefined): boolean {
    const scripts = manifest?.scripts;
    return typeof scripts === 'object' && scripts !== null && typeof (scripts as Record<string, unknown>).build === 'string';
}

export async function buildCommandFor(target: LoadedTarget, configured: ReadonlyMap<string, string>): Promise<BuildCommand | undefined> {
    const { directory, manifest } = await projectDirectoryOf(target);
    const setting = configured.get(target.id) ?? configured.get(ANY_TARGET_COMMAND);
    if (setting !== undefined) {
        return { command: setting, cwd: directory, source: 'setting' };
    }
    if (target.snapshot.bundler.name === 'vite') {
        return { command: 'npx --no vite build', cwd: directory, source: 'vite' };
    }
    return hasBuildScript(manifest) ? { command: 'npm run build', cwd: directory, source: 'build script' } : undefined;
}
