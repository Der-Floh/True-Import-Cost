const DRIVE = /^[a-zA-Z]:\//;

export function toPosix(path: string): string {
    return path.replace(/\\/g, '/');
}

export function isAbsolutePath(path: string): boolean {
    const posix = toPosix(path);
    return posix.startsWith('/') || DRIVE.test(posix);
}

function splitRoot(path: string): { root: string; rest: string } {
    const posix = toPosix(path);
    const drive = DRIVE.exec(posix);
    if (drive) {
        return { root: `${posix.charAt(0).toUpperCase()}:/`, rest: posix.slice(3) };
    }
    if (posix.startsWith('/')) {
        return { root: '/', rest: posix.slice(1) };
    }
    return { root: '', rest: posix };
}

export function normalizePath(path: string): string {
    const { root, rest } = splitRoot(path);
    const segments: string[] = [];
    for (const segment of rest.split('/')) {
        if (segment === '' || segment === '.') {
            continue;
        }
        if (segment === '..') {
            if (segments.length > 0 && segments[segments.length - 1] !== '..') {
                segments.pop();
            } else if (root === '') {
                segments.push('..');
            }
            continue;
        }
        segments.push(segment);
    }
    const joined = segments.join('/');
    if (root === '') {
        return joined === '' ? '.' : joined;
    }
    return root + joined;
}

export function joinPath(base: string, ...segments: string[]): string {
    return normalizePath([base, ...segments].filter(segment => segment !== '').join('/'));
}

export function resolvePath(base: string, path: string): string {
    return isAbsolutePath(path) ? normalizePath(path) : joinPath(base, path);
}

export function dirname(path: string): string {
    const normalized = normalizePath(path);
    const slash = normalized.lastIndexOf('/');
    if (slash < 0) {
        return '.';
    }
    const { root } = splitRoot(normalized);
    return slash < root.length ? root : normalized.slice(0, slash);
}

export function basename(path: string): string {
    const posix = toPosix(path);
    return posix.slice(posix.lastIndexOf('/') + 1);
}

export function relativePath(from: string, to: string): string {
    const source = splitRoot(normalizePath(from));
    const target = splitRoot(normalizePath(to));
    if (source.root !== target.root) {
        return normalizePath(to);
    }
    const fromSegments = source.rest === '' || source.rest === '.' ? [] : source.rest.split('/');
    const toSegments = target.rest === '' || target.rest === '.' ? [] : target.rest.split('/');
    let common = 0;
    while (common < fromSegments.length && common < toSegments.length && fromSegments[common] === toSegments[common]) {
        common++;
    }
    const up = fromSegments.slice(common).map(() => '..');
    const relative = [...up, ...toSegments.slice(common)].join('/');
    return relative === '' ? '.' : relative;
}

export function isWithin(path: string, directory: string): boolean {
    const relative = relativePath(directory, path);
    return relative !== '..' && !relative.startsWith('../') && !isAbsolutePath(relative);
}

export function splitQuery(id: string): { path: string; query: string } {
    const index = id.indexOf('?');
    return index < 0 ? { path: id, query: '' } : { path: id.slice(0, index), query: id.slice(index) };
}

export function extensionOf(path: string): string {
    const name = basename(splitQuery(path).path);
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}
