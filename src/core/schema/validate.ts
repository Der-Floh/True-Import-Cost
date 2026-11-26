import * as z from 'zod/mini';

import { SNAPSHOT_FORMAT, SNAPSHOT_SCHEMA_VERSION } from './snapshot';

import type { BuildSnapshot } from './snapshot';

export const SNAPSHOT_LIMITS = {
    maxModules: 500_000,
    maxImports: 2_000_000,
    maxChunks: 50_000,
    maxAssets: 200_000,
    maxContributionsPerModule: 10_000,
    maxIdsPerChunkField: 50_000,
    maxTextLength: 4096,
} as const;

const text = z.string().check(z.maxLength(SNAPSHOT_LIMITS.maxTextLength));
const name = z.string().check(z.minLength(1), z.maxLength(256));
const byteCount = z.int().check(z.nonnegative());
const idList = z.array(text).check(z.maxLength(SNAPSHOT_LIMITS.maxIdsPerChunkField));

const contributionSchema = z.object({
    chunkId: text,
    bytes: byteCount,
    precision: z.enum(['bundler-reported', 'sourcemap-estimate', 'rendered-length', 'proportional-estimate']),
});

const moduleSchema = z.object({
    id: text,
    path: text,
    virtual: z.optional(z.boolean()),
    entry: z.optional(z.boolean()),
    packageName: z.optional(name),
    packageVersion: z.optional(name),
    packageRoot: z.optional(text),
    sourceBytes: z.optional(byteCount),
    contributions: z.array(contributionSchema).check(z.maxLength(SNAPSHOT_LIMITS.maxContributionsPerModule)),
});

const chunkSchema = z.object({
    id: text,
    kind: z.enum(['js', 'css']),
    bytes: byteCount,
    entry: z.boolean(),
    dynamicEntry: z.boolean(),
    entryModule: z.optional(text),
    imports: idList,
    dynamicImports: idList,
    css: idList,
    assets: idList,
});

const assetSchema = z.object({
    id: text,
    kind: z.enum(['image', 'font', 'wasm', 'html', 'sourcemap', 'other']),
    bytes: byteCount,
});

const importSchema = z.object({
    importer: text,
    specifier: z.optional(text),
    resolvedModule: z.optional(text),
    kind: z.enum(['static', 'dynamic', 'require', 'css', 'reference']),
    external: z.boolean(),
    retained: z.optional(z.boolean()),
});

export const snapshotSchema: z.ZodMiniType<BuildSnapshot> = z.object({
    format: z.literal(SNAPSHOT_FORMAT),
    schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
    id: text,
    target: name,
    createdAt: z.number().check(z.nonnegative()),
    bundler: z.object({
        name,
        version: z.optional(name),
        engine: z.optional(name),
    }),
    mode: z.optional(z.enum(['production', 'development'])),
    root: text,
    modules: z.array(moduleSchema).check(z.maxLength(SNAPSHOT_LIMITS.maxModules)),
    chunks: z.array(chunkSchema).check(z.maxLength(SNAPSHOT_LIMITS.maxChunks)),
    assets: z.array(assetSchema).check(z.maxLength(SNAPSHOT_LIMITS.maxAssets)),
    imports: z.array(importSchema).check(z.maxLength(SNAPSHOT_LIMITS.maxImports)),
});

export type SnapshotParseResult =
    | { readonly ok: true; readonly snapshot: BuildSnapshot }
    | { readonly ok: false; readonly error: string };

const MAX_ERROR_LENGTH = 600;

function fail(error: string): SnapshotParseResult {
    return { ok: false, error: error.length > MAX_ERROR_LENGTH ? `${error.slice(0, MAX_ERROR_LENGTH)}…` : error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSnapshotLike(value: unknown): boolean {
    return isRecord(value) && value.format === SNAPSHOT_FORMAT;
}

function findIntegrityError(snapshot: BuildSnapshot): string | undefined {
    const modules = new Set<string>();
    for (const module of snapshot.modules) {
        if (modules.has(module.id)) {
            return `module "${module.id}" is listed twice`;
        }
        modules.add(module.id);
    }

    const outputs = new Set<string>();
    for (const output of [...snapshot.chunks, ...snapshot.assets]) {
        if (outputs.has(output.id)) {
            return `output "${output.id}" is listed twice`;
        }
        outputs.add(output.id);
    }

    for (const module of snapshot.modules) {
        for (const contribution of module.contributions) {
            if (!outputs.has(contribution.chunkId)) {
                return `module "${module.id}" contributes to unknown output "${contribution.chunkId}"`;
            }
        }
    }

    for (const edge of snapshot.imports) {
        if (!modules.has(edge.importer)) {
            return `an import names unknown importer "${edge.importer}"`;
        }
        if (edge.resolvedModule !== undefined && !modules.has(edge.resolvedModule)) {
            return `an import of "${edge.importer}" resolves to unknown module "${edge.resolvedModule}"`;
        }
        if (edge.resolvedModule === undefined && !edge.external) {
            return `an import of "${edge.importer}" is neither external nor resolved`;
        }
    }

    for (const chunk of snapshot.chunks) {
        if (chunk.entryModule !== undefined && !modules.has(chunk.entryModule)) {
            return `chunk "${chunk.id}" names unknown entry module "${chunk.entryModule}"`;
        }
        const unknownOutput = [chunk.imports, chunk.dynamicImports, chunk.css, chunk.assets].flat().find(id => !outputs.has(id));
        if (unknownOutput !== undefined) {
            return `chunk "${chunk.id}" loads unknown output "${unknownOutput}"`;
        }
    }
    return undefined;
}

function versionError(version: unknown): string {
    if (typeof version === 'number' && Number.isInteger(version) && version > SNAPSHOT_SCHEMA_VERSION) {
        return `the snapshot was written by a newer True Import Cost (schema version ${version}); update the extension or the CLI to read it`;
    }
    if (typeof version === 'number' || typeof version === 'string') {
        return `the snapshot's schema version is ${typeof version === 'string' ? JSON.stringify(version) : version}, not ${SNAPSHOT_SCHEMA_VERSION}`;
    }
    return version === undefined ? 'the snapshot has no schema version' : 'the snapshot\'s schema version is not a number';
}

export function parseSnapshot(value: unknown): SnapshotParseResult {
    if (!isRecord(value)) {
        return fail('the metadata is not a JSON object');
    }
    if (value.format !== SNAPSHOT_FORMAT) {
        return fail(`the metadata is not a True Import Cost build snapshot: its format is not "${SNAPSHOT_FORMAT}"`);
    }
    if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
        return fail(versionError(value.schemaVersion));
    }

    const result = snapshotSchema.safeParse(value);
    if (!result.success) {
        return fail(z.prettifyError(result.error));
    }

    const integrityError = findIntegrityError(result.data);
    return integrityError === undefined ? { ok: true, snapshot: result.data } : fail(integrityError);
}
