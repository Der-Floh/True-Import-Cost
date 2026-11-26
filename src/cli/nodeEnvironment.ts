import { readFile, stat } from 'node:fs/promises';

import type { CliEnvironment, FileAccess, FileInfo } from './environment';

async function info(file: string): Promise<FileInfo | undefined> {
    try {
        const stats = await stat(file);
        return { isFile: stats.isFile(), size: stats.size, modifiedAt: Math.floor(stats.mtimeMs) };
    } catch {
        return undefined;
    }
}

const nodeFiles: FileAccess = { info, read: file => readFile(file) };

export function nodeEnvironment(version: string): CliEnvironment {
    return {
        cwd: process.cwd(),
        version,
        files: nodeFiles,
        stdout: (text) => {
            process.stdout.write(text);
        },
        stderr: (text) => {
            process.stderr.write(text);
        },
    };
}
