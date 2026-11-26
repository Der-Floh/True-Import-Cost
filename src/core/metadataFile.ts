import { normalizeMetadata } from './adapters/registry';
import { precomputeGraph } from './graph/precomputed';
import { fingerprint } from './hash';

import type { PrecomputedGraph } from './graph/precomputed';
import type { BuildSnapshot } from './schema/snapshot';

export interface MetadataFileRequest {
    readonly fileName: string;
    readonly modifiedAt: number;
    readonly targetId?: string;
}

export type MetadataFileResult =
    | { readonly ok: true; readonly snapshot: BuildSnapshot; readonly adapter: string; readonly fingerprint: string; readonly precomputed?: PrecomputedGraph }
    | { readonly ok: false; readonly error: string };

export interface MetadataWorkerRequest {
    readonly id: number;
    readonly bytes: Uint8Array;
    readonly request: MetadataFileRequest;
}

export type MetadataWorkerResponse =
    | {
        readonly id: number;
        readonly ok: true;
        readonly snapshot: string;
        readonly adapter: string;
        readonly fingerprint: string;
        readonly precomputed: PrecomputedGraph;
    }
    | { readonly id: number; readonly ok: false; readonly error: string };

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function readMetadataFile(bytes: Uint8Array, request: MetadataFileRequest): Promise<MetadataFileResult> {
    const text = new TextDecoder().decode(bytes);
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error: unknown) {
        return { ok: false, error: `the file is not valid JSON: ${describe(error)}` };
    }
    const hash = fingerprint(text);
    const target = request.targetId ?? request.fileName.replace(/\.json$/i, '');
    const normalized = await normalizeMetadata(value, { target, createdAt: request.modifiedAt, id: hash });
    return normalized.ok
        ? { ok: true, snapshot: normalized.snapshot, adapter: normalized.adapter, fingerprint: hash }
        : normalized;
}

export async function answerWorkerRequest({ id, bytes, request }: MetadataWorkerRequest): Promise<MetadataWorkerResponse> {
    try {
        const result = await readMetadataFile(bytes, request);
        if (!result.ok) {
            return { id, ...result };
        }
        return {
            id,
            ok: true,
            snapshot: JSON.stringify(result.snapshot),
            adapter: result.adapter,
            fingerprint: result.fingerprint,
            precomputed: precomputeGraph(result.snapshot),
        };
    } catch (error: unknown) {
        return { id, ok: false, error: describe(error) };
    }
}
