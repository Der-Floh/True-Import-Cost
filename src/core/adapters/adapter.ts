import type { BuildMode, BuildSnapshot, BundlerInfo } from '../schema/snapshot';

export interface BuildContext {
    readonly target: string;
    readonly createdAt: number;
    readonly root?: string;
    readonly bundler?: BundlerInfo;
    readonly mode?: BuildMode;
    readonly id?: string;
}

export interface BundlerAdapter<T> {
    readonly name: string;

    supports(input: unknown): input is T;

    normalize(input: T, context: BuildContext): Promise<BuildSnapshot>;
}

export class MetadataError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'MetadataError';
    }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function ownEntries(value: Record<string, unknown>): [string, unknown][] {
    return Object.keys(value).map(key => [key, value[key]]);
}
