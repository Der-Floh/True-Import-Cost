import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { withPackageVersions } from '../core/adapters/packageVersions';

import type { BuildSnapshot } from '../core/schema/snapshot';

export const DEFAULT_OUT_DIR = '.true-import-cost';

export const PLUGIN_NAME = 'true-import-cost';

export function toPosix(value: string): string {
    return value.split(path.sep).join('/').replace(/\\/g, '/');
}

export function snapshotRoot(snapshotFile: string, baseDir: string): string {
    const relative = toPosix(path.relative(path.dirname(snapshotFile), baseDir));
    return relative === '' ? '.' : relative;
}

export function sanitizeTarget(target: string): string {
    const cleaned = target.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned === '' ? 'build' : cleaned.slice(0, 100);
}

function readPackageVersion(baseDir: string, packageRoot: string): string | undefined {
    try {
        const manifest: unknown = JSON.parse(readFileSync(path.resolve(baseDir, packageRoot, 'package.json'), 'utf8'));
        if (typeof manifest === 'object' && manifest !== null && 'version' in manifest && typeof manifest.version === 'string') {
            return manifest.version;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

export function addPackageVersions(snapshot: BuildSnapshot, baseDir: string): Promise<BuildSnapshot> {
    return withPackageVersions(snapshot, root => readPackageVersion(baseDir, root));
}

async function renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            await rename(from, to);
            return;
        } catch (error: unknown) {
            if (attempt >= 4) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
        }
    }
}

export async function writeSnapshot(file: string, snapshot: BuildSnapshot): Promise<void> {
    const directory = path.dirname(file);
    const created = !existsSync(directory);
    await mkdir(directory, { recursive: true });
    if (created && path.basename(directory) === DEFAULT_OUT_DIR) {
        await writeFile(path.join(directory, '.gitignore'), '*\n');
    }
    const temporary = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    try {
        await writeFile(temporary, JSON.stringify(snapshot));
        await renameWithRetry(temporary, file);
    } finally {
        await rm(temporary, { force: true });
    }
}

export function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
