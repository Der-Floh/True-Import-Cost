import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { jsonSchemaErrors } from '../core/support/jsonSchema';
import {
    DEFAULT_OUT_DIR,
    MEASURE_ENV,
    parseSnapshot,
    readMeasureRequest,
    sanitizeTarget,
    SnapshotBuilder,
    snapshotRoot,
    SourceEdits,
    withPackageVersions,
    writeMeasureReport,
    writeSnapshot,
} from '../../plugins/snapshot';

import type { BuildSnapshot } from '../../plugins/snapshot';

const directories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-sdk-'));
    directories.push(directory);
    return directory;
}

afterAll(() => {
    for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function exampleBuild(): BuildSnapshot {
    const builder = new SnapshotBuilder();
    builder.module('src/main.ts', 'src/main.ts', { sourceBytes: 900 });
    builder.module('src/lazy.ts', 'src/lazy.ts', { sourceBytes: 300 });
    builder.module('src/style.css', 'src/style.css', { sourceBytes: 200 });
    builder.module('src/logo.png', 'src/logo.png');
    builder.module('node_modules/ms/index.js', 'node_modules/ms/index.js', { sourceBytes: 1200 });
    builder.module('\0spindle/runtime', '\0spindle/runtime', { virtual: true });
    builder.markEntry('src/main.ts');

    builder.edge({ importer: 'src/main.ts', specifier: './lazy', resolvedModule: 'src/lazy.ts', kind: 'dynamic', external: false });
    builder.edge({ importer: 'src/main.ts', specifier: './style.css', resolvedModule: 'src/style.css', kind: 'css', external: false });
    builder.edge({ importer: 'src/main.ts', specifier: './logo.png', resolvedModule: 'src/logo.png', kind: 'reference', external: false });
    builder.edge({ importer: 'src/lazy.ts', specifier: 'ms', resolvedModule: 'node_modules/ms/index.js', kind: 'static', external: false });
    builder.edge({ importer: 'src/main.ts', specifier: 'vscode', kind: 'static', external: true, retained: true });

    builder.chunk({
        id: 'assets/main.js',
        kind: 'js',
        bytes: 700,
        entry: true,
        entryModule: 'src/main.ts',
        dynamicImports: ['assets/lazy.js'],
        css: ['assets/main.css'],
        assets: ['assets/logo.png'],
    });
    builder.chunk({ id: 'assets/lazy.js', kind: 'js', bytes: 650, dynamicEntry: true, entryModule: 'src/lazy.ts' });
    builder.chunk({ id: 'assets/main.css', kind: 'css', bytes: 150 });
    builder.asset({ id: 'assets/logo.png', kind: 'image', bytes: 4000 });
    builder.asset({ id: 'assets/main.js.map', kind: 'sourcemap', bytes: 2000 });

    builder.contribute('src/main.ts', 'assets/main.js', 600, 'bundler-reported');
    builder.contribute('\0spindle/runtime', 'assets/main.js', 100, 'bundler-reported');
    builder.contribute('src/lazy.ts', 'assets/lazy.js', 150, 'rendered-length');
    builder.contribute('node_modules/ms/index.js', 'assets/lazy.js', 500, 'proportional-estimate');
    builder.contribute('src/style.css', 'assets/main.css', 150, 'proportional-estimate');
    builder.contribute('src/logo.png', 'assets/logo.png', 4000, 'bundler-reported');

    return builder.build({ target: 'web', createdAt: 1_764_150_000_000, root: '..', bundler: { name: 'spindle', version: '2.4.0' }, mode: 'production' });
}

describe('a snapshot made with @true-import-cost/snapshot', () => {
    it('reads back unchanged after a trip through JSON', () => {
        const snapshot = exampleBuild();

        expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual({ ok: true, snapshot });
    });

    it('matches the JSON Schema', () => {
        expect(jsonSchemaErrors(JSON.parse(JSON.stringify(exampleBuild())))).toEqual([]);
    });

    it('names the package of each module under node_modules, and takes package versions from a reader', async () => {
        const snapshot = await withPackageVersions(exampleBuild(), root => (root === 'node_modules/ms' ? '2.1.3' : undefined));

        expect(snapshot.modules.filter(module => module.packageName !== undefined)).toEqual([
            expect.objectContaining({ id: 'node_modules/ms/index.js', packageName: 'ms', packageRoot: 'node_modules/ms', packageVersion: '2.1.3' }),
        ]);
        expect(parseSnapshot(snapshot).ok).toBe(true);
    });

    it('is read without the fields a reader does not know', () => {
        const snapshot = exampleBuild();
        const extended = { ...snapshot, spindle: { cache: 'warm' }, chunks: snapshot.chunks.map(chunk => ({ ...chunk, gzipBytes: 100 })) };

        expect(parseSnapshot(extended)).toEqual({ ok: true, snapshot });
        expect(jsonSchemaErrors(extended)).toEqual([]);
    });

    it('is refused, with a request to update, when its schema version is newer', () => {
        const newer = { ...exampleBuild(), schemaVersion: 2 };

        expect(parseSnapshot(newer)).toEqual({
            ok: false,
            error: 'the snapshot was written by a newer True Import Cost (schema version 2); update the extension or the CLI to read it',
        });
        expect(jsonSchemaErrors(newer)).not.toEqual([]);
    });

    it('is refused when a chunk names a file under another id than the snapshot lists it', () => {
        const snapshot = exampleBuild();
        const broken = { ...snapshot, chunks: snapshot.chunks.map(chunk => (chunk.entry ? { ...chunk, dynamicImports: ['lazy.js'] } : chunk)) };

        expect(parseSnapshot(broken)).toEqual({ ok: false, error: 'chunk "assets/main.js" loads unknown output "lazy.js"' });
    });
});

describe('writeSnapshot', () => {
    it('writes a snapshot that reads back unchanged into a folder version control ignores', async () => {
        const project = temporaryDirectory();
        const file = path.join(project, DEFAULT_OUT_DIR, `${sanitizeTarget('web app')}.json`);
        const snapshot = { ...exampleBuild(), root: snapshotRoot(file, project) };

        await writeSnapshot(file, snapshot);

        expect(path.relative(project, file)).toBe(path.join('.true-import-cost', 'web-app.json'));
        expect(snapshot.root).toBe('..');
        expect(parseSnapshot(JSON.parse(readFileSync(file, 'utf8')))).toEqual({ ok: true, snapshot });
        expect(readFileSync(path.join(project, DEFAULT_OUT_DIR, '.gitignore'), 'utf8')).toBe('*\n');
    });
});

describe('measurement mode', () => {
    it('is off unless the variable names a request', () => {
        expect(readMeasureRequest({})).toBeUndefined();
        expect(readMeasureRequest({ [MEASURE_ENV]: '' })).toBeUndefined();
    });

    it('applies the edits of the request to the source it loads, and reports them next to the snapshot', async () => {
        const directory = temporaryDirectory();
        const source = path.join(directory, 'src', 'main.ts');
        const statement = "import { heavy } from 'heavy';";
        const requestFile = path.join(directory, 'request.json');
        writeFileSync(requestFile, JSON.stringify({
            version: 1,
            outDir: path.join(directory, 'measure'),
            edits: [{ file: source, start: 0, end: statement.length, expected: statement, replacement: 'const heavy = void 0;' }],
        }));

        const request = readMeasureRequest({ [MEASURE_ENV]: requestFile });
        const edits = new SourceEdits(request?.edits ?? []);
        const snapshotFile = path.join(request?.outDir ?? '', 'web.json');

        expect(edits.filter().test(source)).toBe(true);
        expect(edits.apply(source, `${statement}\nheavy();\n`)).toBe('const heavy = void 0;\nheavy();\n');
        expect(edits.apply(path.join(directory, 'src', 'other.ts'), statement)).toBe(statement);

        await writeMeasureReport(snapshotFile, edits.report('web'));

        expect(JSON.parse(readFileSync(path.join(directory, 'measure', 'web.edits.json'), 'utf8'))).toEqual({ version: 1, target: 'web', applied: [source], missing: [] });
    });

    it('refuses to edit a file that changed after the measurement was planned', () => {
        const edits = new SourceEdits([{ file: '/work/src/main.ts', start: 0, end: 6, expected: 'import', replacement: 'const' }]);

        expect(() => edits.apply('/work/src/main.ts', 'export const x = 1;'))
            .toThrow('/work/src/main.ts changed after True Import Cost planned the measurement; save it and measure again.');
    });

    it('refuses a request it cannot validate', () => {
        const file = path.join(temporaryDirectory(), 'request.json');
        writeFileSync(file, JSON.stringify({ version: 1, outDir: 'relative/folder', edits: [] }));

        expect(() => readMeasureRequest({ [MEASURE_ENV]: file })).toThrow(`${MEASURE_ENV} names a file that is not a True Import Cost measurement request of version 1.`);
    });
});
