import { isRecord, MetadataError, ownEntries } from './adapter';
import { SnapshotBuilder } from './snapshotBuilder';
import { normalizePath, splitQuery, toPosix } from '../paths';
import { assetKindOf, chunkKindOf } from '../schema/snapshot';

import type { BuildContext, BundlerAdapter } from './adapter';
import type { BuildSnapshot, ImportKind } from '../schema/snapshot';

export interface EsbuildImportRecord {
    readonly path: string;
    readonly kind: string;
    readonly external?: boolean;
    readonly original?: string;
}

export interface EsbuildMetafile {
    readonly inputs: Readonly<Record<string, { readonly bytes: number; readonly imports: readonly EsbuildImportRecord[] }>>;
    readonly outputs: Readonly<Record<string, {
        readonly bytes: number;
        readonly inputs: Readonly<Record<string, { readonly bytesInOutput: number }>>;
        readonly imports: readonly EsbuildImportRecord[];
        readonly entryPoint?: string;
        readonly cssBundle?: string;
    }>>;
}

interface ImportRecord {
    readonly path: string;
    readonly kind: string;
    readonly external: boolean;
    readonly original?: string;
}

interface InputRecord {
    readonly bytes: number;
    readonly imports: readonly ImportRecord[];
}

interface OutputRecord {
    readonly bytes: number;
    readonly inputs: ReadonlyMap<string, number>;
    readonly imports: readonly ImportRecord[];
    readonly entryPoint?: string;
    readonly cssBundle?: string;
}

const NAMESPACED = /^[a-zA-Z][\w+.-]*:/;

function isVirtualPath(path: string): boolean {
    return path.startsWith('<') || (NAMESPACED.test(path) && !/^[a-zA-Z]:[\\/]/.test(path));
}

function readNumber(value: unknown, where: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new MetadataError(`${where} is not a byte count`);
    }
    return value;
}

function readImports(value: unknown, where: string): ImportRecord[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new MetadataError(`${where}.imports is not a list`);
    }
    return value.map((entry: unknown, index): ImportRecord => {
        if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.kind !== 'string') {
            throw new MetadataError(`${where}.imports[${index}] is not an import record`);
        }
        const record: ImportRecord = { path: toPosix(entry.path), kind: entry.kind, external: entry.external === true };
        return typeof entry.original === 'string' ? { ...record, original: entry.original } : record;
    });
}

function readMetafile(value: unknown): { inputs: Map<string, InputRecord>; outputs: Map<string, OutputRecord> } {
    if (!isRecord(value) || !isRecord(value.inputs) || !isRecord(value.outputs)) {
        throw new MetadataError('the metadata is not an esbuild metafile');
    }

    const inputs = new Map<string, InputRecord>();
    for (const [path, entry] of ownEntries(value.inputs)) {
        if (!isRecord(entry)) {
            throw new MetadataError(`input "${path}" is not an object`);
        }
        inputs.set(toPosix(path), {
            bytes: readNumber(entry.bytes, `input "${path}"`),
            imports: readImports(entry.imports, `input "${path}"`),
        });
    }

    const outputs = new Map<string, OutputRecord>();
    for (const [path, entry] of ownEntries(value.outputs)) {
        if (!isRecord(entry)) {
            throw new MetadataError(`output "${path}" is not an object`);
        }
        const outputInputs = new Map<string, number>();
        if (entry.inputs !== undefined) {
            if (!isRecord(entry.inputs)) {
                throw new MetadataError(`output "${path}" has no input map`);
            }
            for (const [inputPath, contribution] of ownEntries(entry.inputs)) {
                if (!isRecord(contribution)) {
                    throw new MetadataError(`output "${path}" input "${inputPath}" is not an object`);
                }
                outputInputs.set(toPosix(inputPath), readNumber(contribution.bytesInOutput, `output "${path}" input "${inputPath}"`));
            }
        }
        outputs.set(toPosix(path), {
            bytes: readNumber(entry.bytes, `output "${path}"`),
            inputs: outputInputs,
            imports: readImports(entry.imports, `output "${path}"`),
            ...(typeof entry.entryPoint === 'string' ? { entryPoint: toPosix(entry.entryPoint) } : {}),
            ...(typeof entry.cssBundle === 'string' ? { cssBundle: toPosix(entry.cssBundle) } : {}),
        });
    }
    return { inputs, outputs };
}

function importKindOf(kind: string): ImportKind | undefined {
    switch (kind) {
        case 'import-statement':
            return 'static';
        case 'require-call':
            return 'require';
        case 'dynamic-import':
            return 'dynamic';
        case 'import-rule':
        case 'composes-from':
            return 'css';
        case 'require-resolve':
        case 'url-token':
            return 'reference';
        default:
            return undefined;
    }
}

function moduleId(path: string): string {
    return isVirtualPath(path) ? path : normalizePath(path);
}

function linkedOutputs(output: OutputRecord, outputs: ReadonlyMap<string, OutputRecord>, wanted: (record: ImportRecord) => boolean): string[] {
    return output.imports.filter(record => !record.external && outputs.has(record.path) && wanted(record)).map(record => record.path);
}

export function isEsbuildMetafile(value: unknown): value is EsbuildMetafile {
    return isRecord(value) && isRecord(value.inputs) && isRecord(value.outputs) && value.format === undefined;
}

export function normalizeEsbuildMetafile(metafile: unknown, context: BuildContext): BuildSnapshot {
    const { inputs, outputs } = readMetafile(metafile);
    const builder = new SnapshotBuilder();

    for (const [path, input] of inputs) {
        const id = moduleId(path);
        const virtual = isVirtualPath(path);
        builder.module(id, virtual ? path : normalizePath(splitQuery(path).path), { virtual, sourceBytes: input.bytes });
    }

    const retainedExternals = new Set<string>();
    for (const output of outputs.values()) {
        for (const record of output.imports) {
            if (record.external) {
                retainedExternals.add(record.path);
            }
        }
    }

    for (const [path, input] of inputs) {
        const importer = moduleId(path);
        for (const record of input.imports) {
            const kind = importKindOf(record.kind);
            if (kind === undefined) {
                continue;
            }
            if (record.external) {
                builder.edge({
                    importer,
                    specifier: record.original ?? record.path,
                    kind,
                    external: true,
                    retained: retainedExternals.has(record.path),
                });
                continue;
            }
            const resolved = moduleId(record.path);
            if (!builder.hasModule(resolved)) {
                builder.module(resolved, isVirtualPath(record.path) ? record.path : normalizePath(splitQuery(record.path).path), { virtual: isVirtualPath(record.path) });
            }
            builder.edge({
                importer,
                ...(record.original === undefined ? {} : { specifier: record.original }),
                resolvedModule: resolved,
                kind,
                external: false,
            });
        }
    }

    for (const [path, output] of outputs) {
        if (output.entryPoint !== undefined) {
            builder.markEntryCandidate(moduleId(output.entryPoint));
        }
        const chunkKind = chunkKindOf(path);
        if (chunkKind === undefined) {
            builder.asset({ id: path, kind: assetKindOf(path), bytes: output.bytes });
        }
        for (const [inputPath, bytes] of output.inputs) {
            const id = moduleId(inputPath);
            if (!builder.hasModule(id)) {
                builder.module(id, isVirtualPath(inputPath) ? inputPath : normalizePath(splitQuery(inputPath).path), { virtual: isVirtualPath(inputPath) });
            }
            builder.contribute(id, path, bytes, 'bundler-reported');
        }
    }

    builder.resolveEntryCandidates();

    for (const [path, output] of outputs) {
        const chunkKind = chunkKindOf(path);
        if (chunkKind === undefined) {
            continue;
        }
        const entryModule = output.entryPoint === undefined ? undefined : moduleId(output.entryPoint);
        const isEntry = entryModule !== undefined && builder.isEntry(entryModule);
        builder.chunk({
            id: path,
            kind: chunkKind,
            bytes: output.bytes,
            entry: isEntry,
            dynamicEntry: entryModule !== undefined && !isEntry,
            ...(entryModule === undefined ? {} : { entryModule }),
            imports: linkedOutputs(output, outputs, record => record.kind !== 'dynamic-import' && chunkKindOf(record.path) !== undefined),
            dynamicImports: linkedOutputs(output, outputs, record => record.kind === 'dynamic-import'),
            css: output.cssBundle !== undefined && outputs.has(output.cssBundle) ? [output.cssBundle] : [],
            assets: linkedOutputs(output, outputs, record => record.kind !== 'dynamic-import' && chunkKindOf(record.path) === undefined),
        });
    }

    return builder.build({ bundler: { name: 'esbuild' }, ...context });
}

export const esbuildAdapter: BundlerAdapter<EsbuildMetafile> = {
    name: 'esbuild',
    supports: isEsbuildMetafile,
    normalize: (input, context) => Promise.resolve(normalizeEsbuildMetafile(input, context)),
};
