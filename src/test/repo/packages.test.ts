import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly main: string;
    readonly module: string;
    readonly types: string;
    readonly files: readonly string[];
    readonly exports: Readonly<Record<string, unknown>>;
    readonly peerDependencies: Readonly<Record<string, string>>;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly publishConfig?: { readonly access?: string };
}

interface PackedFile {
    readonly path: string;
}

const ROOT = process.cwd();
const PACKAGES = [
    { directory: 'packages/esbuild', name: '@true-import-cost/esbuild', peers: ['esbuild'], typesFrom: ['esbuild'], extraFiles: [] },
    { directory: 'packages/vite', name: '@true-import-cost/vite', peers: ['vite'], typesFrom: ['vite'], extraFiles: [] },
    { directory: 'packages/webpack', name: '@true-import-cost/webpack', peers: ['@rspack/core', 'webpack'], typesFrom: [], extraFiles: ['dist/webpackLoader.cjs'] },
] as const;

const require = createRequire(import.meta.url);

function manifestOf(directory: string): PackageManifest {
    return JSON.parse(readFileSync(path.join(ROOT, directory, 'package.json'), 'utf8')) as PackageManifest;
}

function exportTargets(value: unknown): string[] {
    if (typeof value === 'string') {
        return [value];
    }
    if (typeof value === 'object' && value !== null) {
        return Object.values(value).flatMap(exportTargets);
    }
    return [];
}

describe.each(PACKAGES)('the $name package', ({ directory, name, peers, typesFrom, extraFiles }) => {
    const manifest = manifestOf(directory);

    it('is public, MIT licensed and has no runtime dependencies', () => {
        expect(manifest.name).toBe(name);
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(manifest.license).toBe('MIT');
        expect(manifest.publishConfig?.access).toBe('public');
        expect(manifest.dependencies ?? {}).toEqual({});
        expect(Object.keys(manifest.peerDependencies).sort()).toEqual(peers);
    });

    it('carries the repository licence unchanged', () => {
        expect(readFileSync(path.join(ROOT, directory, 'LICENSE'), 'utf8')).toBe(readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'));
    });

    it('points every entry at a file the build produces', () => {
        const targets = [manifest.main, manifest.module, manifest.types, ...exportTargets(manifest.exports)].filter(target => target.startsWith('./dist/'));

        expect(targets.length).toBeGreaterThanOrEqual(7);
        for (const target of targets) {
            expect(existsSync(path.join(ROOT, directory, target)), target).toBe(true);
        }
    });

    it('packs only its bundle, its declarations, its readme and its licence', () => {
        const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: path.join(ROOT, directory), encoding: 'utf8' });
        const [packed] = JSON.parse(output) as { files: PackedFile[] }[];
        const files = (packed?.files ?? []).map(file => file.path).sort();

        expect(files).toEqual(['LICENSE', 'README.md', 'dist/index.cjs', 'dist/index.d.cts', 'dist/index.d.mts', 'dist/index.mjs', ...extraFiles, 'package.json'].sort());
    }, 60_000);

    it('loads from CommonJS and from ES modules', async () => {
        const fromRequire = require(path.join(ROOT, directory, 'dist/index.cjs')) as { trueImportCost: () => { name: string }; default: unknown };
        const fromImport = await import(pathToFileURL(path.join(ROOT, directory, 'dist/index.mjs')).href) as { trueImportCost: () => { name: string }; default: unknown };

        expect(fromRequire.trueImportCost().name).toBe('true-import-cost');
        expect(fromImport.trueImportCost().name).toBe('true-import-cost');
        expect(fromImport.default).toBe(fromImport.trueImportCost);
    });

    it('declares its options, importing types from its bundler at most', () => {
        const declaration = readFileSync(path.join(ROOT, directory, 'dist/index.d.mts'), 'utf8');

        expect(declaration).toContain('export interface TrueImportCostOptions');
        expect([...declaration.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1])).toEqual(typesFrom);
    });
});

interface CliManifest {
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly bin: Readonly<Record<string, string>>;
    readonly engines: { readonly node: string };
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
    readonly publishConfig?: { readonly access?: string };
}

describe('the @true-import-cost/cli package', () => {
    const directory = path.join(ROOT, 'packages/cli');
    const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as CliManifest;

    it('is public, MIT licensed, runs on Node 18 and later, and depends on nothing', () => {
        expect(manifest.name).toBe('@true-import-cost/cli');
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(manifest.license).toBe('MIT');
        expect(manifest.publishConfig?.access).toBe('public');
        expect(manifest.engines.node).toBe('>=18');
        expect(manifest.dependencies ?? {}).toEqual({});
        expect(manifest.peerDependencies ?? {}).toEqual({});
    });

    it('carries the repository licence unchanged', () => {
        expect(readFileSync(path.join(directory, 'LICENSE'), 'utf8')).toBe(readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'));
    });

    it('installs one command: a single script that needs nothing but Node', () => {
        const source = readFileSync(path.join(directory, manifest.bin['true-import-cost'] ?? 'missing'), 'utf8');
        const required = [...source.matchAll(/\brequire\("([^"]+)"\)/g)].map(match => match[1] ?? '');

        expect(Object.keys(manifest.bin)).toEqual(['true-import-cost']);
        expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
        expect(required.length).toBeGreaterThan(0);
        expect(required.filter(name => !isBuiltin(name))).toEqual([]);
    });

    it('packs only its command, its readme and its licence', () => {
        const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: directory, encoding: 'utf8' });
        const [packed] = JSON.parse(output) as { files: PackedFile[] }[];

        expect((packed?.files ?? []).map(file => file.path).sort()).toEqual(['LICENSE', 'README.md', 'dist/cli.cjs', 'package.json']);
    }, 60_000);
});
