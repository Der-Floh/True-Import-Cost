import path from 'node:path';

import { run } from '../../cli/run';

import type { CliEnvironment, FileAccess, FileInfo } from '../../cli/environment';
import type { BuildMode, BuildSnapshot, BundlerInfo } from '../../core/schema/snapshot';

export const WORK = path.resolve('/work/app');

export const VERSION = '9.8.7';

export type MemoryFiles = Readonly<Record<string, string | Uint8Array>>;

export interface CliRun {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

export interface BuildIdentity {
    readonly target: string;
    readonly bundler?: BundlerInfo;
    readonly mode?: BuildMode;
}

const MODIFIED_AT = 1_700_000_000_000;

function memoryFiles(files: MemoryFiles): FileAccess {
    const stored = new Map(Object.entries(files).map(([file, content]) => [
        path.resolve(WORK, file),
        typeof content === 'string' ? new TextEncoder().encode(content) : content,
    ]));
    const isDirectory = (file: string): boolean => [...stored.keys()].some(key => key.startsWith(`${file}${path.sep}`));
    return {
        info: (file): Promise<FileInfo | undefined> => {
            const bytes = stored.get(file);
            if (bytes !== undefined) {
                return Promise.resolve({ isFile: true, size: bytes.byteLength, modifiedAt: MODIFIED_AT });
            }
            return Promise.resolve(isDirectory(file) ? { isFile: false, size: 0, modifiedAt: MODIFIED_AT } : undefined);
        },
        read: (file) => {
            const bytes = stored.get(file);
            return bytes === undefined ? Promise.reject(new Error(`ENOENT: no such file or directory, open '${file}'`)) : Promise.resolve(bytes);
        },
    };
}

export function memoryEnvironment(files: MemoryFiles, output: { stdout: string[]; stderr: string[] }): CliEnvironment {
    return {
        cwd: WORK,
        version: VERSION,
        files: memoryFiles(files),
        stdout: text => output.stdout.push(text),
        stderr: text => output.stderr.push(text),
    };
}

export async function runCli(argv: readonly string[], files: MemoryFiles = {}): Promise<CliRun> {
    const output = { stdout: [] as string[], stderr: [] as string[] };
    const code = await run(argv, memoryEnvironment(files, output));
    return { code, stdout: output.stdout.join(''), stderr: output.stderr.join('') };
}

export function identified(snapshot: BuildSnapshot, identity: BuildIdentity): string {
    return JSON.stringify({ ...snapshot, ...identity, bundler: identity.bundler ?? snapshot.bundler });
}

export function asciiOnly(text: string): boolean {
    return /^[\t\n\x20-\x7e]*$/.test(text);
}
