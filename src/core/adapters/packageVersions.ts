import type { BuildSnapshot } from '../schema/snapshot';

export type PackageVersionReader = (packageRoot: string) => Promise<string | undefined> | string | undefined;

const CONCURRENCY = 16;
const MAX_VERSION_LENGTH = 256;

async function readSafely(read: PackageVersionReader, root: string): Promise<string | undefined> {
    try {
        const version = await read(root);
        return typeof version === 'string' && version !== '' && version.length <= MAX_VERSION_LENGTH ? version : undefined;
    } catch {
        return undefined;
    }
}

export async function withPackageVersions(snapshot: BuildSnapshot, read: PackageVersionReader): Promise<BuildSnapshot> {
    const roots = new Set<string>();
    for (const module of snapshot.modules) {
        if (module.packageRoot !== undefined && module.packageVersion === undefined) {
            roots.add(module.packageRoot);
        }
    }
    if (roots.size === 0) {
        return snapshot;
    }

    const versions = new Map<string, string>();
    const pending = [...roots];
    for (let index = 0; index < pending.length; index += CONCURRENCY) {
        const batch = pending.slice(index, index + CONCURRENCY);
        const results = await Promise.all(batch.map(root => readSafely(read, root)));
        batch.forEach((root, position) => {
            const version = results[position];
            if (version !== undefined) {
                versions.set(root, version);
            }
        });
    }
    if (versions.size === 0) {
        return snapshot;
    }

    return {
        ...snapshot,
        modules: snapshot.modules.map((module) => {
            const version = module.packageRoot === undefined || module.packageVersion !== undefined ? undefined : versions.get(module.packageRoot);
            return version === undefined ? module : { ...module, packageVersion: version };
        }),
    };
}
