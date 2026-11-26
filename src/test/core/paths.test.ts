import { describe, expect, it } from 'vitest';

import {
    basename,
    dirname,
    extensionOf,
    isAbsolutePath,
    isWithin,
    joinPath,
    normalizePath,
    relativePath,
    resolvePath,
    splitQuery,
    toPosix,
} from '../../core/paths';

describe('toPosix', () => {
    it('turns backslashes into forward slashes', () => {
        expect(toPosix('C:\\work\\app\\src\\main.ts')).toBe('C:/work/app/src/main.ts');
        expect(toPosix('src/main.ts')).toBe('src/main.ts');
    });
});

describe('isAbsolutePath', () => {
    it('recognises POSIX roots and Windows drive letters in either slash style', () => {
        expect(isAbsolutePath('/work/app')).toBe(true);
        expect(isAbsolutePath('C:\\work\\app')).toBe(true);
        expect(isAbsolutePath('d:/work/app')).toBe(true);
    });

    it('treats relative and drive-relative paths as not absolute', () => {
        expect(isAbsolutePath('src/main.ts')).toBe(false);
        expect(isAbsolutePath('./main.ts')).toBe(false);
        expect(isAbsolutePath('C:main.ts')).toBe(false);
        expect(isAbsolutePath('')).toBe(false);
    });
});

describe('normalizePath', () => {
    it('resolves dot segments and collapses repeated slashes', () => {
        expect(normalizePath('src//components/./Button/../index.ts')).toBe('src/components/index.ts');
    });

    it('keeps the leading parent segments of a relative path', () => {
        expect(normalizePath('../../shared/util.ts')).toBe('../../shared/util.ts');
        expect(normalizePath('src/../../shared')).toBe('../shared');
    });

    it('never climbs above an absolute root', () => {
        expect(normalizePath('/../../etc/hosts')).toBe('/etc/hosts');
        expect(normalizePath('C:\\..\\Windows')).toBe('C:/Windows');
    });

    it('upper-cases Windows drive letters and uses forward slashes', () => {
        expect(normalizePath('c:\\Users\\dev\\app\\..\\lib\\index.js')).toBe('C:/Users/dev/lib/index.js');
    });

    it('returns "." for an empty relative path and the root for a bare root', () => {
        expect(normalizePath('')).toBe('.');
        expect(normalizePath('./')).toBe('.');
        expect(normalizePath('src/..')).toBe('.');
        expect(normalizePath('/')).toBe('/');
        expect(normalizePath('d:\\')).toBe('D:/');
    });
});

describe('joinPath', () => {
    it('joins segments and normalises the result', () => {
        expect(joinPath('/work/app', 'src', '../lib/index.ts')).toBe('/work/app/lib/index.ts');
        expect(joinPath('C:\\work\\app', 'src\\main.ts')).toBe('C:/work/app/src/main.ts');
    });

    it('ignores empty segments', () => {
        expect(joinPath('', 'src/main.ts')).toBe('src/main.ts');
        expect(joinPath('src', '')).toBe('src');
    });
});

describe('resolvePath', () => {
    it('resolves a relative path against the base', () => {
        expect(resolvePath('/work/app/dist/assets', '../../src/main.ts')).toBe('/work/app/src/main.ts');
    });

    it('keeps an absolute path as it is, including a Windows drive path', () => {
        expect(resolvePath('/work/app', '/opt/lib/index.js')).toBe('/opt/lib/index.js');
        expect(resolvePath('/work/app', 'D:\\lib\\index.js')).toBe('D:/lib/index.js');
    });
});

describe('dirname', () => {
    it('returns the parent directory of a file', () => {
        expect(dirname('src/components/Button.vue')).toBe('src/components');
        expect(dirname('C:\\work\\app\\src\\main.ts')).toBe('C:/work/app/src');
    });

    it('returns "." for a bare file name', () => {
        expect(dirname('main.ts')).toBe('.');
    });

    it('stops at the root of an absolute path', () => {
        expect(dirname('/main.ts')).toBe('/');
        expect(dirname('/')).toBe('/');
        expect(dirname('C:\\main.ts')).toBe('C:/');
        expect(dirname('C:/')).toBe('C:/');
    });
});

describe('basename', () => {
    it('returns the last segment in either slash style', () => {
        expect(basename('src\\components\\Button.vue')).toBe('Button.vue');
        expect(basename('/work/app/main.ts')).toBe('main.ts');
        expect(basename('main.ts')).toBe('main.ts');
    });
});

describe('relativePath', () => {
    it('describes how to get from one directory to a path', () => {
        expect(relativePath('/work/app', '/work/app/src/main.ts')).toBe('src/main.ts');
        expect(relativePath('/work/app/dist/assets', '/work/app/src/main.ts')).toBe('../../src/main.ts');
        expect(relativePath('src', 'src/components/Button.vue')).toBe('components/Button.vue');
        expect(relativePath('.', 'src/main.ts')).toBe('src/main.ts');
    });

    it('returns "." for the same directory', () => {
        expect(relativePath('/work/app', '/work/app/')).toBe('.');
    });

    it('compares Windows drive letters without regard to case', () => {
        expect(relativePath('C:\\work\\app', 'c:/work/app/src/main.ts')).toBe('src/main.ts');
    });

    it('returns the target unchanged when it is on another root', () => {
        expect(relativePath('C:/work/app', 'D:\\lib\\index.js')).toBe('D:/lib/index.js');
        expect(relativePath('/work/app', 'C:/work/app/main.ts')).toBe('C:/work/app/main.ts');
    });
});

describe('isWithin', () => {
    it('accepts the directory itself and anything below it', () => {
        expect(isWithin('/work/app', '/work/app')).toBe(true);
        expect(isWithin('/work/app/src/main.ts', '/work/app')).toBe(true);
        expect(isWithin('/work/app/..cache/entry.js', '/work/app')).toBe(true);
    });

    it('rejects siblings that only share a name prefix', () => {
        expect(isWithin('/work/application/main.ts', '/work/app')).toBe(false);
    });

    it('rejects paths that climb out of the directory', () => {
        expect(isWithin('/work/app/../secrets/key.pem', '/work/app')).toBe(false);
    });

    it('handles Windows drives', () => {
        expect(isWithin('C:\\work\\app\\src\\main.ts', 'c:/work/app')).toBe(true);
        expect(isWithin('D:/work/app/main.ts', 'C:/work/app')).toBe(false);
    });
});

describe('splitQuery', () => {
    it('splits a module id at the first question mark', () => {
        expect(splitQuery('/src/App.vue?vue&type=style&index=0&lang.css')).toEqual({ path: '/src/App.vue', query: '?vue&type=style&index=0&lang.css' });
    });

    it('returns an empty query when there is none', () => {
        expect(splitQuery('src/main.ts')).toEqual({ path: 'src/main.ts', query: '' });
    });
});

describe('extensionOf', () => {
    it('returns the lower-cased extension of the file, ignoring any query', () => {
        expect(extensionOf('src/App.VUE?vue&type=script&lang.ts')).toBe('.vue');
        expect(extensionOf('archive.tar.gz')).toBe('.gz');
    });

    it('returns nothing for dot files, extension-less files and dotted directories', () => {
        expect(extensionOf('src/.env')).toBe('');
        expect(extensionOf('Makefile')).toBe('');
        expect(extensionOf('types.d/readme')).toBe('');
    });
});
