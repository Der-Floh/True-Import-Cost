import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

import { withPackageVersions } from '../../core/adapters/packageVersions';
import { attributeImport, locateDocument } from '../../core/attribution/attribute';
import { BuildGraph } from '../../core/graph/buildGraph';
import { analyzeDocument } from '../../parser';
import { toQuery } from '../../extension/services/importQuery';

import type { ImportCost } from '../../core/attribution/attribute';
import type { BuildSnapshot } from '../../core/schema/snapshot';
import type { SourceImport } from '../../parser';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/projects');

export const ESBUILD_FIXTURE = path.join(FIXTURES, 'esbuild-node');

export const VITE_FIXTURE = path.join(FIXTURES, 'vite-vue');

export interface AttributedImport {
    readonly source: SourceImport;
    readonly cost: ImportCost;
}

export async function buildEsbuildFixture(options: esbuild.BuildOptions = {}): Promise<{ readonly metafile: esbuild.Metafile }> {
    const result = await esbuild.build({
        absWorkingDir: ESBUILD_FIXTURE,
        entryPoints: ['src/extension.ts'],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        minify: true,
        external: ['vscode'],
        metafile: true,
        write: false,
        outfile: 'dist/extension.js',
        logLevel: 'silent',
        ...options,
    });
    if (!result.metafile) {
        throw new Error('esbuild wrote no metafile');
    }
    return { metafile: result.metafile };
}

const LANGUAGES: Readonly<Record<string, string>> = { '.ts': 'typescript', '.js': 'javascript', '.vue': 'vue' };

export function attributeFile(graph: BuildGraph, fixture: string, documentPath: string): Map<string, AttributedImport[]> {
    const text = readFileSync(path.join(fixture, documentPath), 'utf8');
    const languageId = LANGUAGES[path.extname(documentPath)] ?? 'typescript';
    const analysis = analyzeDocument(languageId, documentPath, text, { usage: true });
    const location = locateDocument(graph, documentPath);
    if (!location) {
        throw new Error(`${documentPath} is not part of the build`);
    }
    const bySpecifier = new Map<string, AttributedImport[]>();
    for (const source of analysis.imports) {
        const cost = attributeImport(location, toQuery(source));
        bySpecifier.set(source.specifier, [...(bySpecifier.get(source.specifier) ?? []), { source, cost }]);
    }
    return bySpecifier;
}

export function only(map: Map<string, AttributedImport[]>, specifier: string): ImportCost {
    const found = map.get(specifier);
    if (found?.length !== 1 || !found[0]) {
        throw new Error(`expected exactly one import of "${specifier}", found ${found?.length ?? 0}`);
    }
    return found[0].cost;
}

export function graphOf(snapshot: ConstructorParameters<typeof BuildGraph>[0]): BuildGraph {
    return new BuildGraph(snapshot);
}

export function withFixtureVersions(snapshot: BuildSnapshot, fixture: string): Promise<BuildSnapshot> {
    return withPackageVersions(snapshot, (root) => {
        const manifest = JSON.parse(readFileSync(path.join(fixture, root, 'package.json'), 'utf8')) as { version?: unknown };
        return typeof manifest.version === 'string' ? manifest.version : undefined;
    });
}
