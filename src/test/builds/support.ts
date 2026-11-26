import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

import { jsonSchemaErrors } from '../core/support/jsonSchema';
import { withPackageVersions } from '../../core/adapters/packageVersions';
import { attributeImport, locateDocument } from '../../core/attribution/attribute';
import { BuildGraph } from '../../core/graph/buildGraph';
import { parseSnapshot } from '../../core/schema/validate';
import { analyzeDocument, analyzeExports } from '../../parser';
import { toQuery } from '../../extension/services/importQuery';

import type { ImportCost } from '../../core/attribution/attribute';
import type { ExportResolver } from '../../core/attribution/barrels';
import type { BuildSnapshot } from '../../core/schema/snapshot';
import type { ExportAnalysis, SourceImport } from '../../parser';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/projects');

export const ESBUILD_FIXTURE = path.join(FIXTURES, 'esbuild-node');

export const VITE_FIXTURE = path.join(FIXTURES, 'vite-vue');

export const BARRELS_FIXTURE = path.join(FIXTURES, 'esbuild-barrels');

export function readSnapshot(file: string): BuildSnapshot {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const schemaErrors = jsonSchemaErrors(value);
    if (schemaErrors.length > 0) {
        throw new Error(`${file} does not match the JSON Schema of a snapshot: ${schemaErrors.join('; ')}`);
    }
    const result = parseSnapshot(value);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.snapshot;
}

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

export function exportsOnDisk(graph: BuildGraph, fixture: string): ExportResolver {
    const analyses = new Map<string, ExportAnalysis>();
    return (moduleId) => {
        const module = graph.module(moduleId);
        const file = module === undefined || module.virtual === true ? undefined : path.join(fixture, module.path);
        if (file === undefined || !existsSync(file)) {
            return { kind: 'unknown' };
        }
        let analysis = analyses.get(file);
        if (!analysis) {
            analysis = analyzeExports('', file, readFileSync(file, 'utf8'));
            analyses.set(file, analysis);
        }
        return analysis;
    };
}

export function attributeFile(graph: BuildGraph, fixture: string, documentPath: string): Map<string, AttributedImport[]> {
    const text = readFileSync(path.join(fixture, documentPath), 'utf8');
    const languageId = LANGUAGES[path.extname(documentPath)] ?? 'typescript';
    const analysis = analyzeDocument(languageId, documentPath, text, { usage: true });
    const location = locateDocument(graph, documentPath);
    if (!location) {
        throw new Error(`${documentPath} is not part of the build`);
    }
    const queries = analysis.imports.map(source => toQuery(source, analysis.usageAnalysed));
    const barrels = { exportsOf: exportsOnDisk(graph, fixture), otherImports: queries };
    const bySpecifier = new Map<string, AttributedImport[]>();
    analysis.imports.forEach((source, index) => {
        const cost = attributeImport(location, queries[index]!, barrels);
        bySpecifier.set(source.specifier, [...(bySpecifier.get(source.specifier) ?? []), { source, cost }]);
    });
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
