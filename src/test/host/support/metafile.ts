export type EsbuildImportKind = 'import-statement' | 'dynamic-import' | 'require-call';

export interface EsbuildImport {
    readonly path: string;
    readonly kind: EsbuildImportKind;
    readonly external?: boolean;
    readonly original?: string;
}

interface EsbuildOutput {
    bytes: number;
    readonly inputs: Record<string, { readonly bytesInOutput: number }>;
    readonly imports: EsbuildImport[];
    readonly exports: readonly string[];
    readonly entryPoint?: string;
}

export interface EsbuildMetafile {
    readonly inputs: Record<string, { readonly bytes: number; readonly imports: readonly EsbuildImport[] }>;
    readonly outputs: Record<string, EsbuildOutput>;
}

export interface InputSpec {
    readonly output?: number;
    readonly bytes?: number;
    readonly imports?: readonly EsbuildImport[];
    readonly chunk?: string;
}

export interface MetafileSpec {
    readonly entry: string;
    readonly outfile?: string;
    readonly inputs: Readonly<Record<string, InputSpec>>;
    readonly chunks?: Readonly<Record<string, string>>;
    readonly retainedExternals?: readonly string[];
}

export function staticImport(original: string, path: string): EsbuildImport {
    return { path, kind: 'import-statement', original };
}

export function dynamicImport(original: string, path: string): EsbuildImport {
    return { path, kind: 'dynamic-import', original };
}

export function requireCall(original: string, path: string): EsbuildImport {
    return { path, kind: 'require-call', original };
}

export function externalImport(specifier: string, kind: EsbuildImportKind = 'import-statement'): EsbuildImport {
    return { path: specifier, kind, external: true };
}

export function esbuildMetafile(spec: MetafileSpec): EsbuildMetafile {
    const outfile = spec.outfile ?? 'out/main.js';
    const outputs: Record<string, EsbuildOutput> = {
        [outfile]: { bytes: 0, inputs: {}, imports: [], exports: [], entryPoint: spec.entry },
    };
    for (const [chunk, entryPoint] of Object.entries(spec.chunks ?? {})) {
        outputs[outfile]!.imports.push({ path: chunk, kind: 'dynamic-import' });
        outputs[chunk] = { bytes: 0, inputs: {}, imports: [], exports: [], entryPoint };
    }
    const inputs: EsbuildMetafile['inputs'] = {};
    for (const [path, input] of Object.entries(spec.inputs)) {
        const imports = input.imports ?? [];
        inputs[path] = { bytes: input.bytes ?? (input.output ?? 0) + 100, imports };
        if (input.output === undefined) {
            continue;
        }
        const output = outputs[input.chunk ?? outfile];
        if (!output) {
            throw new Error(`no output "${input.chunk ?? outfile}" for ${path}`);
        }
        output.inputs[path] = { bytesInOutput: input.output };
        output.bytes += input.output;
        for (const record of imports) {
            const retained = spec.retainedExternals?.includes(record.path) ?? true;
            if (record.external === true && retained && !output.imports.some(each => each.external === true && each.path === record.path)) {
                output.imports.push({ path: record.path, kind: 'require-call', external: true });
            }
        }
    }
    return { inputs, outputs };
}
