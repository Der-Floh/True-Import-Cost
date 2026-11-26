import { splitQuery, toPosix } from './paths';

export interface PackageIdentity {
    readonly name: string;
    readonly root: string;
    readonly version?: string;
}

const NODE_MODULES = 'node_modules';

const STORE_DIRECTORIES = new Set(['.pnpm', '.deno', '.bun']);

function versionFromStoreEntry(entry: string, name: string): string | undefined {
    const encodedName = name.replace('/', '+');
    if (!entry.startsWith(`${encodedName}@`)) {
        return undefined;
    }
    const rest = entry.slice(encodedName.length + 1);
    const version = /^[^_(]+/.exec(rest)?.[0];
    return version === undefined || version === '' ? undefined : version;
}

export function packageFromPath(path: string): PackageIdentity | undefined {
    const segments = toPosix(splitQuery(path).path).replace(/^\0/, '').split('/');
    const index = segments.lastIndexOf(NODE_MODULES);
    if (index < 0 || index + 1 >= segments.length) {
        return undefined;
    }

    const first = segments[index + 1] ?? '';
    if (first === '' || first.startsWith('.')) {
        return undefined;
    }

    const scoped = first.startsWith('@');
    if (scoped && (index + 2 >= segments.length || (segments[index + 2] ?? '') === '')) {
        return undefined;
    }
    const name = scoped ? `${first}/${segments[index + 2] ?? ''}` : first;
    const root = segments.slice(0, index + (scoped ? 3 : 2)).join('/');

    const storeIndex = index - 2;
    const store = segments[storeIndex];
    const storeEntry = segments[storeIndex + 1];
    const version = store !== undefined && storeEntry !== undefined && STORE_DIRECTORIES.has(store)
        ? versionFromStoreEntry(storeEntry, name)
        : undefined;

    return version === undefined ? { name, root } : { name, root, version };
}

export interface SpecifierParts {
    readonly packageName: string;
    readonly subpath: string;
}

export function isRelativeSpecifier(specifier: string): boolean {
    return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

export function parseBareSpecifier(specifier: string): SpecifierParts | undefined {
    if (specifier === '' || isRelativeSpecifier(specifier) || specifier.startsWith('/') || /^[a-zA-Z][\w+.-]*:/.test(specifier)) {
        return undefined;
    }
    const segments = specifier.split('/');
    const first = segments[0] ?? '';
    if (first.startsWith('@')) {
        const second = segments[1];
        if (first.length < 2 || second === undefined || second === '') {
            return undefined;
        }
        return { packageName: `${first}/${second}`, subpath: segments.slice(2).join('/') };
    }
    return { packageName: first, subpath: segments.slice(1).join('/') };
}
