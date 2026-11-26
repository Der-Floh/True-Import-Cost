import type { BuildContext } from '../../../core/adapters/adapter';
import type { EsbuildImportRecord, EsbuildMetafile } from '../../../core/adapters/esbuild';

export type EsbuildImportKind =
    | 'entry-point'
    | 'import-statement'
    | 'require-call'
    | 'dynamic-import'
    | 'require-resolve'
    | 'import-rule'
    | 'composes-from'
    | 'url-token'
    | 'file-loader';

type MetafileInput = EsbuildMetafile['inputs'][string];
type MetafileOutput = EsbuildMetafile['outputs'][string];

export interface OutputSpec {
    readonly bytes?: number;
    readonly imports?: readonly EsbuildImportRecord[];
    readonly entryPoint?: string;
    readonly cssBundle?: string;
}

export const BUILD_CONTEXT: BuildContext = { target: 'app', createdAt: 1_700_000_000_000 };

export function importOf(path: string, kind: EsbuildImportKind, original?: string): EsbuildImportRecord {
    return original === undefined ? { path, kind } : { path, kind, original };
}

export function statement(path: string, original?: string): EsbuildImportRecord {
    return importOf(path, 'import-statement', original);
}

export function dynamicImport(path: string, original?: string): EsbuildImportRecord {
    return importOf(path, 'dynamic-import', original);
}

export function externalImport(path: string, kind: EsbuildImportKind = 'import-statement'): EsbuildImportRecord {
    return { path, kind, external: true };
}

export function input(bytes: number, imports: readonly EsbuildImportRecord[] = []): MetafileInput {
    return { bytes, imports };
}

export function output(bytesInOutput: Readonly<Record<string, number>>, spec: OutputSpec = {}): MetafileOutput {
    const inputs = Object.fromEntries(Object.entries(bytesInOutput).map(([path, bytes]) => [path, { bytesInOutput: bytes }]));
    return {
        bytes: spec.bytes ?? Object.values(bytesInOutput).reduce((sum, bytes) => sum + bytes, 0),
        inputs,
        imports: spec.imports ?? [],
        ...(spec.entryPoint === undefined ? {} : { entryPoint: spec.entryPoint }),
        ...(spec.cssBundle === undefined ? {} : { cssBundle: spec.cssBundle }),
    };
}

export function metafile(
    inputs: Readonly<Record<string, MetafileInput>>,
    outputs: Readonly<Record<string, MetafileOutput>>,
): EsbuildMetafile {
    return { inputs, outputs };
}
