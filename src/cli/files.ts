import path from 'node:path';

import { CliError, describeError } from './environment';

import type { CliEnvironment } from './environment';

interface TextFile {
    readonly text: string;
    readonly modifiedAt: number;
}

const BYTES_PER_MB = 1024 * 1024;

export async function readTextFile(environment: CliEnvironment, file: string, maxSizeMB: number): Promise<TextFile> {
    const resolved = path.resolve(environment.cwd, file);
    const maxBytes = Math.round(maxSizeMB * BYTES_PER_MB);
    const info = await environment.files.info(resolved);
    if (info === undefined) {
        throw new CliError(`${file}: the file does not exist`);
    }
    if (!info.isFile) {
        throw new CliError(`${file}: not a file`);
    }
    if (info.size > maxBytes) {
        throw new CliError(`${file}: the file is ${Math.ceil(info.size / BYTES_PER_MB)} MB, above the ${maxSizeMB} MB limit; raise it with --max-size`);
    }
    let bytes: Uint8Array;
    try {
        bytes = await environment.files.read(resolved);
    } catch (error: unknown) {
        throw new CliError(`${file}: the file could not be read: ${describeError(error)}`);
    }
    if (bytes.byteLength > maxBytes) {
        throw new CliError(`${file}: the file grew past the ${maxSizeMB} MB limit while it was read`);
    }
    return { text: new TextDecoder().decode(bytes), modifiedAt: info.modifiedAt };
}

export function parseJson(file: string, text: string, parse: (text: string) => unknown = JSON.parse): unknown {
    try {
        return parse(text);
    } catch (error: unknown) {
        throw new CliError(`${file}: the file is not valid JSON: ${describeError(error)}`);
    }
}
