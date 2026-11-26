import { posix } from 'node:path';

const DRIVE_PATH = /^\/[a-zA-Z]:/;

function encodeSegment(segment: string): string {
    return encodeURIComponent(segment).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function withoutTrailingSlash(path: string): string {
    return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

export class Uri {
    public readonly scheme: string;
    public readonly authority: string;
    public readonly path: string;
    public readonly query: string;
    public readonly fragment: string;

    private constructor(scheme: string, authority: string, path: string, query = '', fragment = '') {
        this.scheme = scheme;
        this.authority = authority;
        this.path = path;
        this.query = query;
        this.fragment = fragment;
    }

    // Backslashes count as separators on every platform, as they do on Windows, so tests read the same everywhere.
    public static file(path: string): Uri {
        let normalized = path.replace(/\\/g, '/');
        let authority = '';
        if (normalized.startsWith('//')) {
            const slash = normalized.indexOf('/', 2);
            authority = slash < 0 ? normalized.slice(2) : normalized.slice(2, slash);
            normalized = slash < 0 ? '/' : normalized.slice(slash);
        }
        return new Uri('file', authority, normalized.startsWith('/') ? normalized : `/${normalized}`);
    }

    public static parse(value: string): Uri {
        const match = /^([a-zA-Z][\w+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
        if (!match) {
            throw new Error(`[UriError]: cannot parse "${value}"`);
        }
        const [, scheme = '', authority = '', path = '', query = '', fragment = ''] = match;
        return new Uri(scheme, decodeURIComponent(authority), decodeURIComponent(path), decodeURIComponent(query), decodeURIComponent(fragment));
    }

    public static joinPath(base: Uri, ...segments: string[]): Uri {
        const parts = base.scheme === 'file' ? segments.map(segment => segment.replace(/\\/g, '/')) : segments;
        return new Uri(base.scheme, base.authority, posix.join(base.path, ...parts), base.query, base.fragment);
    }

    public with(change: { readonly scheme?: string; readonly authority?: string; readonly path?: string; readonly query?: string; readonly fragment?: string }): Uri {
        return new Uri(change.scheme ?? this.scheme, change.authority ?? this.authority, change.path ?? this.path, change.query ?? this.query, change.fragment ?? this.fragment);
    }

    public toJSON(): { scheme: string; authority: string; path: string; query: string; fragment: string } {
        return { scheme: this.scheme, authority: this.authority, path: this.path, query: this.query, fragment: this.fragment };
    }

    public get fsPath(): string {
        if (this.scheme === 'file' && this.authority !== '' && this.path.length > 1) {
            return `//${this.authority}${this.path}`;
        }
        return DRIVE_PATH.test(this.path) ? `${this.path.charAt(1).toLowerCase()}${this.path.slice(2)}` : this.path;
    }

    public toString(): string {
        const authority = this.authority !== '' || this.scheme === 'file' ? `//${this.authority}` : '';
        const path = DRIVE_PATH.test(this.path) ? `/${this.path.charAt(1).toLowerCase()}${this.path.slice(2)}` : this.path;
        const query = this.query === '' ? '' : `?${encodeURIComponent(this.query)}`;
        const fragment = this.fragment === '' ? '' : `#${encodeURIComponent(this.fragment)}`;
        return `${this.scheme}:${authority}${path.split('/').map(encodeSegment).join('/')}${query}${fragment}`;
    }
}

export class RelativePattern {
    public readonly baseUri: Uri;
    public readonly base: string;
    public readonly pattern: string;

    public constructor(base: Uri | { readonly uri: Uri } | string, pattern: string) {
        this.baseUri = typeof base === 'string' ? Uri.file(base) : 'uri' in base ? base.uri : base;
        this.base = this.baseUri.fsPath;
        this.pattern = pattern;
    }
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function bracketSource(body: string): string {
    const negated = body.startsWith('!') || body.startsWith('^');
    const members = (negated ? body.slice(1) : body).replace(/\//g, '').replace(/[\\\]^]/g, '\\$&');
    return `[${negated ? '^' : ''}${members}]`;
}

function globSource(glob: string): string {
    let source = '';
    let groups = 0;
    for (let index = 0; index < glob.length; index++) {
        const character = glob.charAt(index);
        if (character === '*' && glob.charAt(index + 1) === '*') {
            const startsSegment = index === 0 || glob.charAt(index - 1) === '/';
            const after = glob.charAt(index + 2);
            index++;
            if (startsSegment && after === '/') {
                source += '(?:[^/]*/)*';
                index++;
            } else {
                source += startsSegment && after === '' ? '.*' : '[^/]*';
            }
        } else if (character === '*') {
            source += '[^/]*';
        } else if (character === '?') {
            source += '[^/]';
        } else if (character === '{') {
            groups++;
            source += '(?:';
        } else if (character === '}' && groups > 0) {
            groups--;
            source += ')';
        } else if (character === ',' && groups > 0) {
            source += '|';
        } else if (character === '[' && glob.indexOf(']', index + 1) > index) {
            const close = glob.indexOf(']', index + 1);
            source += bracketSource(glob.slice(index + 1, close));
            index = close;
        } else {
            source += escapeRegExp(character);
        }
    }
    return source;
}

export function globMatcher(glob: string): (path: string) => boolean {
    const expression = new RegExp(`^${globSource(glob)}$`);
    return path => expression.test(path);
}

export function isWithin(path: string, folder: string): boolean {
    const base = withoutTrailingSlash(folder);
    return path === base || path.startsWith(base === '/' ? '/' : `${base}/`);
}

export function relativeTo(folder: string, path: string): string {
    const base = withoutTrailingSlash(folder);
    return path.slice(base === '/' ? 1 : base.length + 1);
}

export function sameRoot(a: Uri, b: Uri): boolean {
    return a.scheme === b.scheme && a.authority === b.authority;
}

export function patternMatcher(pattern: RelativePattern | string): (uri: Uri) => boolean {
    if (typeof pattern === 'string') {
        const matches = globMatcher(pattern);
        return uri => matches(uri.path) || matches(uri.path.replace(/^\//, ''));
    }
    const matches = globMatcher(pattern.pattern);
    const base = pattern.baseUri;
    return uri => sameRoot(uri, base) && uri.path !== base.path && isWithin(uri.path, base.path) && matches(relativeTo(base.path, uri.path));
}
