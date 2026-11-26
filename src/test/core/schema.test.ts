import { describe, expect, it } from 'vitest';

import { jsonSchemaErrors } from './support/jsonSchema';
import { fixture, inPackage } from './support/snapshot';
import {
    assetKindOf,
    chunkKindOf,
    PRECISION_RANK,
    SNAPSHOT_FORMAT,
    totalOutputBytes,
} from '../../core/schema/snapshot';
import { isSnapshotLike, parseSnapshot, SNAPSHOT_LIMITS } from '../../core/schema/validate';

import type { SnapshotParseResult } from '../../core/schema/validate';

type JsonPath = readonly (string | number)[];

type JsonContainer = Record<string | number, unknown>;

const VALID = fixture()
    .module('src/main.ts', 300, { entry: true })
    .module('src/util.ts', 120)
    .module('node_modules/ms/index.js', 80, inPackage('ms', '2.1.3'))
    .imports('src/main.ts', 'src/util.ts', { specifier: './util' })
    .imports('src/util.ts', 'node_modules/ms/index.js', { specifier: 'ms' })
    .external('src/main.ts', 'vscode', { retained: true })
    .chunk({ id: 'dist/main.js', bytes: 500, entry: true, entryModule: 'src/main.ts', assets: ['dist/logo.png'] })
    .asset({ id: 'dist/logo.png', kind: 'image', bytes: 2048 })
    .asset({ id: 'dist/main.js.map', kind: 'sourcemap', bytes: 4096 })
    .snapshot();

function draft(): JsonContainer {
    return structuredClone(VALID) as unknown as JsonContainer;
}

function lookup(root: JsonContainer, path: JsonPath): JsonContainer {
    return path.reduce<JsonContainer>((container, key) => container[key] as JsonContainer, root);
}

function withValue(path: JsonPath, value: unknown): JsonContainer {
    const root = draft();
    lookup(root, path.slice(0, -1))[path.at(-1)!] = value;
    return root;
}

function without(path: JsonPath): JsonContainer {
    const root = draft();
    delete lookup(root, path.slice(0, -1))[path.at(-1)!];
    return root;
}

function withPushed(path: JsonPath, value: unknown): JsonContainer {
    const root = draft();
    (lookup(root, path) as unknown as unknown[]).push(value);
    return root;
}

function describePath(path: JsonPath): string {
    return path.map((key, index) => (typeof key === 'number' ? `[${key}]` : `${index === 0 ? '' : '.'}${key}`)).join('');
}

function errorOf(result: SnapshotParseResult): string {
    if (result.ok) {
        throw new Error('expected the snapshot to be rejected');
    }
    return result.error;
}

function withUnknownFields(): JsonContainer {
    const root = draft();
    const paths: JsonPath[] = [[], ['bundler'], ['modules', 2], ['modules', 0, 'contributions', 0], ['chunks', 0], ['assets', 0], ['imports', 0], ['imports', 2]];
    for (const path of paths) {
        Object.assign(lookup(root, path), { addedLater: { nested: [1, 2, 3] }, gzipBytes: 120 });
    }
    return root;
}

const MALFORMED: readonly [string, JsonPath, unknown][] = [
    ['a byte count given as a string', ['modules', 0, 'contributions', 0, 'bytes'], '300'],
    ['a negative byte count', ['modules', 0, 'contributions', 0, 'bytes'], -1],
    ['a fractional byte count', ['modules', 0, 'contributions', 0, 'bytes'], 2.5],
    ['an unknown precision', ['modules', 0, 'contributions', 0, 'precision'], 'exact'],
    ['an unknown chunk kind', ['chunks', 0, 'kind'], 'wasm'],
    ['a non-boolean entry flag', ['chunks', 0, 'entry'], 'yes'],
    ['a chunk import list that is not a list', ['chunks', 0, 'imports'], 'dist/other.js'],
    ['an unknown asset kind', ['assets', 0, 'kind'], 'video'],
    ['an unknown import kind', ['imports', 0, 'kind'], 'import-statement'],
    ['a non-boolean external flag', ['imports', 2, 'external'], 1],
    ['a negative creation time', ['createdAt'], -1],
    ['an empty target name', ['target'], ''],
    ['an empty package version', ['modules', 2, 'packageVersion'], ''],
    ['a bundler given as a string', ['bundler'], 'esbuild'],
    ['a module list given as an object', ['modules'], {}],
    ['an unknown build mode', ['mode'], 'staging'],
];

const REQUIRED: readonly [string, JsonPath][] = [
    ['the contributions of a module', ['modules', 0, 'contributions']],
    ['the kind of an import', ['imports', 0, 'kind']],
    ['the dynamic imports of a chunk', ['chunks', 0, 'dynamicImports']],
    ['the root', ['root']],
    ['the bundler name', ['bundler', 'name']],
];

const INCONSISTENT: readonly [string, () => JsonContainer][] = [
    ['a module listed twice', () => withPushed(['modules'], VALID.modules[1])],
    ['a chunk and an asset with the same id', () => withValue(['assets', 0, 'id'], 'dist/main.js')],
    ['a contribution to an output that does not exist', () => withValue(['modules', 0, 'contributions', 0, 'chunkId'], 'dist/gone.js')],
    ['an import whose importer is not a module', () => withValue(['imports', 0, 'importer'], 'src/gone.ts')],
    ['an import that resolves to a module that does not exist', () => withValue(['imports', 0, 'resolvedModule'], 'src/gone.ts')],
    ['an import that is neither external nor resolved', () => without(['imports', 0, 'resolvedModule'])],
    ['a chunk whose entry module does not exist', () => withValue(['chunks', 0, 'entryModule'], 'src/gone.ts')],
    ['a chunk that loads an output that does not exist', () => withValue(['chunks', 0, 'imports'], ['dist/gone.js'])],
];

describe('assetKindOf', () => {
    it('classifies output files by extension, ignoring case', () => {
        expect(assetKindOf('assets/logo-3f2a.PNG')).toBe('image');
        expect(assetKindOf('assets/icon.svg')).toBe('image');
        expect(assetKindOf('fonts/inter.woff2')).toBe('font');
        expect(assetKindOf('wasm/engine.wasm')).toBe('wasm');
        expect(assetKindOf('index.html')).toBe('html');
        expect(assetKindOf('main.js.map')).toBe('sourcemap');
        expect(assetKindOf('data/manifest.json')).toBe('other');
        expect(assetKindOf('LICENSE')).toBe('other');
    });
});

describe('chunkKindOf', () => {
    it('recognises JavaScript and CSS outputs only', () => {
        expect(chunkKindOf('main.js')).toBe('js');
        expect(chunkKindOf('main.mjs')).toBe('js');
        expect(chunkKindOf('main.CJS')).toBe('js');
        expect(chunkKindOf('main.css')).toBe('css');
        expect(chunkKindOf('main.js.map')).toBeUndefined();
        expect(chunkKindOf('logo.png')).toBeUndefined();
    });
});

describe('totalOutputBytes', () => {
    it('adds chunks and assets but leaves out source maps', () => {
        expect(totalOutputBytes(VALID)).toBe(500 + 2048);
    });
});

describe('PRECISION_RANK', () => {
    it('ranks measurements from bundler-reported to proportional estimates', () => {
        const ordered = Object.entries(PRECISION_RANK).sort(([, a], [, b]) => a - b).map(([precision]) => precision);

        expect(ordered).toEqual(['bundler-reported', 'sourcemap-estimate', 'rendered-length', 'proportional-estimate']);
    });
});

describe('isSnapshotLike', () => {
    it('only looks at the format marker', () => {
        expect(isSnapshotLike({ format: SNAPSHOT_FORMAT })).toBe(true);
        expect(isSnapshotLike({ format: 'true-import-cost/rollup-build' })).toBe(false);
        expect(isSnapshotLike({ inputs: {}, outputs: {} })).toBe(false);
        expect(isSnapshotLike([VALID])).toBe(false);
        expect(isSnapshotLike(null)).toBe(false);
    });
});

describe('parseSnapshot', () => {
    it('accepts a well-formed snapshot and returns its content', () => {
        expect(parseSnapshot(draft())).toEqual({ ok: true, snapshot: VALID });
    });

    it('accepts the optional fields', () => {
        const root = draft();
        root.mode = 'production';
        root.bundler = { name: 'vite', version: '8.3.8', engine: 'rolldown 1.0.0' };
        Object.assign(lookup(root, ['modules', 1]), { virtual: true, sourceBytes: 512 });

        const result = parseSnapshot(root);

        expect(result.ok).toBe(true);
        expect(result.ok && result.snapshot.modules[1]).toMatchObject({ virtual: true, sourceBytes: 512 });
    });

    it('drops fields it does not know', () => {
        const result = parseSnapshot(withValue(['modules', 0, 'color'], 'red'));

        expect(result.ok && result.snapshot.modules[0]).toEqual(VALID.modules[0]);
    });

    it('accepts a snapshot with fields it does not know at every level, and returns it without them', () => {
        expect(parseSnapshot(withUnknownFields())).toEqual({ ok: true, snapshot: VALID });
    });

    it('ignores a "__proto__" key without polluting Object.prototype', () => {
        const text = JSON.stringify(VALID).replace('{"format"', '{"__proto__":{"polluted":true,"modules":[]},"format"');

        const result = parseSnapshot(JSON.parse(text));

        expect(result).toEqual({ ok: true, snapshot: VALID });
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('rejects values that are not JSON objects', () => {
        for (const value of [null, [], 'snapshot', 42, undefined]) {
            expect(parseSnapshot(value)).toEqual({ ok: false, error: 'the metadata is not a JSON object' });
        }
    });

    it('says that metadata of another format is not a build snapshot', () => {
        const notASnapshot = 'the metadata is not a True Import Cost build snapshot: its format is not "true-import-cost/build-snapshot"';

        expect(errorOf(parseSnapshot(withValue(['format'], 'true-import-cost/rollup-build')))).toBe(notASnapshot);
        expect(errorOf(parseSnapshot(without(['format'])))).toBe(notASnapshot);
    });

    it('asks for an update to read a snapshot of a newer schema version', () => {
        for (const version of [2, 17]) {
            expect(errorOf(parseSnapshot(withValue(['schemaVersion'], version))))
                .toBe(`the snapshot was written by a newer True Import Cost (schema version ${version}); update the extension or the CLI to read it`);
        }
    });

    it('rejects a schema version that is missing or not one True Import Cost ever wrote', () => {
        expect(errorOf(parseSnapshot(without(['schemaVersion'])))).toBe('the snapshot has no schema version');
        expect(errorOf(parseSnapshot(withValue(['schemaVersion'], '1')))).toBe('the snapshot\'s schema version is "1", not 1');
        expect(errorOf(parseSnapshot(withValue(['schemaVersion'], 0)))).toBe('the snapshot\'s schema version is 0, not 1');
        expect(errorOf(parseSnapshot(withValue(['schemaVersion'], 1.5)))).toBe('the snapshot\'s schema version is 1.5, not 1');
        expect(errorOf(parseSnapshot(withValue(['schemaVersion'], null)))).toBe('the snapshot\'s schema version is not a number');
        expect(errorOf(parseSnapshot(withValue(['schemaVersion'], { major: 1 })))).toBe('the snapshot\'s schema version is not a number');
    });

    it.each(MALFORMED)('rejects %s', (_, path, value) => {
        expect(errorOf(parseSnapshot(withValue(path, value)))).toContain(`at ${describePath(path)}`);
    });

    it.each(REQUIRED)('rejects a snapshot missing %s', (_, path) => {
        expect(parseSnapshot(without(path)).ok).toBe(false);
    });

    it('accepts strings up to the length limit and rejects longer ones', () => {
        const limit = SNAPSHOT_LIMITS.maxTextLength;

        expect(parseSnapshot(withValue(['root'], 'r'.repeat(limit))).ok).toBe(true);
        expect(errorOf(parseSnapshot(withValue(['root'], 'r'.repeat(limit + 1))))).toContain('at root');
        expect(errorOf(parseSnapshot(withValue(['modules', 1, 'path'], 'p'.repeat(limit + 1))))).toContain('at modules[1].path');
    });

    it('caps names such as the target and package names at 256 characters', () => {
        expect(parseSnapshot(withValue(['target'], 't'.repeat(256))).ok).toBe(true);
        expect(errorOf(parseSnapshot(withValue(['target'], 't'.repeat(257))))).toContain('at target');
        expect(errorOf(parseSnapshot(withValue(['modules', 2, 'packageName'], 'n'.repeat(257))))).toContain('at modules[2].packageName');
    });

    it('rejects a module that is listed twice', () => {
        expect(errorOf(parseSnapshot(withPushed(['modules'], VALID.modules[1])))).toBe('module "src/util.ts" is listed twice');
    });

    it('rejects an output id that is used by a chunk and an asset', () => {
        expect(errorOf(parseSnapshot(withValue(['assets', 0, 'id'], 'dist/main.js')))).toBe('output "dist/main.js" is listed twice');
    });

    it('rejects a contribution to an output that does not exist', () => {
        expect(errorOf(parseSnapshot(withValue(['modules', 0, 'contributions', 0, 'chunkId'], 'dist/gone.js'))))
            .toBe('module "src/main.ts" contributes to unknown output "dist/gone.js"');
    });

    it('accepts a contribution to an asset', () => {
        expect(parseSnapshot(withValue(['modules', 0, 'contributions', 0, 'chunkId'], 'dist/logo.png')).ok).toBe(true);
    });

    it('rejects an import whose importer is not a module', () => {
        expect(errorOf(parseSnapshot(withValue(['imports', 0, 'importer'], 'src/gone.ts'))))
            .toBe('an import names unknown importer "src/gone.ts"');
    });

    it('rejects an import that resolves to a module that does not exist', () => {
        expect(errorOf(parseSnapshot(withValue(['imports', 0, 'resolvedModule'], 'src/gone.ts'))))
            .toBe('an import of "src/main.ts" resolves to unknown module "src/gone.ts"');
    });

    it('rejects an import that is neither external nor resolved', () => {
        expect(errorOf(parseSnapshot(without(['imports', 0, 'resolvedModule']))))
            .toBe('an import of "src/main.ts" is neither external nor resolved');
    });

    it('rejects a chunk whose entry module does not exist', () => {
        expect(errorOf(parseSnapshot(withValue(['chunks', 0, 'entryModule'], 'src/gone.ts'))))
            .toBe('chunk "dist/main.js" names unknown entry module "src/gone.ts"');
    });

    it.each(['imports', 'dynamicImports', 'css', 'assets'])('rejects a chunk whose %s name an output that does not exist', (field) => {
        expect(errorOf(parseSnapshot(withValue(['chunks', 0, field], ['dist/gone.js']))))
            .toBe('chunk "dist/main.js" loads unknown output "dist/gone.js"');
    });

    it('accepts a chunk that loads any chunk or asset of the snapshot', () => {
        const root = withValue(['chunks', 0, 'dynamicImports'], ['dist/logo.png']);
        lookup(root, ['chunks', 0]).imports = ['dist/main.js.map'];

        expect(parseSnapshot(root).ok).toBe(true);
    });

    it('keeps the error message short when many fields are wrong', () => {
        const modules = Array.from({ length: 200 }, (_, index) => ({ id: `m${index}`, path: 42, contributions: 'none' }));

        const error = errorOf(parseSnapshot(withValue(['modules'], modules)));

        expect(error).toHaveLength(601);
        expect(error.endsWith('…')).toBe(true);
    });
});

describe('the JSON Schema of a snapshot', () => {
    it('accepts what parseSnapshot accepts, with and without the optional fields', () => {
        const root = draft();
        root.mode = 'development';
        root.bundler = { name: 'vite', version: '8.3.8', engine: 'rolldown 1.0.0' };
        Object.assign(lookup(root, ['modules', 1]), { virtual: true, sourceBytes: 512 });

        expect(jsonSchemaErrors(draft())).toEqual([]);
        expect(jsonSchemaErrors(root)).toEqual([]);
    });

    it('accepts fields it does not know at every level, as parseSnapshot does', () => {
        expect(jsonSchemaErrors(withUnknownFields())).toEqual([]);
    });

    it.each(MALFORMED)('rejects %s, as parseSnapshot does', (_, path, value) => {
        expect(jsonSchemaErrors(withValue(path, value))).not.toEqual([]);
    });

    it.each(REQUIRED)('rejects a snapshot missing %s, as parseSnapshot does', (_, path) => {
        expect(jsonSchemaErrors(without(path))).not.toEqual([]);
    });

    it('rejects metadata of another format and every other schema version', () => {
        for (const value of [withValue(['format'], 'true-import-cost/rollup-build'), without(['format']), withValue(['schemaVersion'], 2), without(['schemaVersion'])]) {
            expect(jsonSchemaErrors(value)).not.toEqual([]);
        }
    });

    it('applies the same limits to strings and names as parseSnapshot', () => {
        expect(jsonSchemaErrors(withValue(['root'], 'r'.repeat(SNAPSHOT_LIMITS.maxTextLength)))).toEqual([]);
        expect(jsonSchemaErrors(withValue(['root'], 'r'.repeat(SNAPSHOT_LIMITS.maxTextLength + 1)))).toEqual(['/root must NOT have more than 4096 characters']);
        expect(jsonSchemaErrors(withValue(['modules', 2, 'packageName'], 'n'.repeat(256)))).toEqual([]);
        expect(jsonSchemaErrors(withValue(['modules', 2, 'packageName'], 'n'.repeat(257)))).toEqual(['/modules/2/packageName must NOT have more than 256 characters']);
    });

    it.each(INCONSISTENT)('leaves %s to parseSnapshot, which rejects it', (_, value) => {
        expect(jsonSchemaErrors(value())).toEqual([]);
        expect(parseSnapshot(value()).ok).toBe(false);
    });
});
