import { availableParallelism, totalmem } from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

const VSCODE_MOCK = resolvePath('./src/test/__mocks__/vscode.ts');

const WORKER_MEMORY = 512 * 1024 * 1024;
const MAX_WORKERS = Math.max(1, Math.min(availableParallelism(), Math.floor(totalmem() / WORKER_MEMORY)));

export default defineConfig({
    test: {
        maxWorkers: MAX_WORKERS,
        projects: [
            {
                test: {
                    name: 'core',
                    environment: 'node',
                    include: ['src/test/core/**/*.test.ts', 'src/test/parser/**/*.test.ts'],
                },
            },
            {
                test: {
                    name: 'builds',
                    environment: 'node',
                    include: ['src/test/builds/**/*.test.ts'],
                    testTimeout: 60_000,
                    hookTimeout: 120_000,
                },
            },
            {
                resolve: {
                    alias: { vscode: VSCODE_MOCK },
                },
                test: {
                    name: 'host',
                    environment: 'node',
                    include: ['src/test/host/**/*.test.ts'],
                    setupFiles: [resolvePath('./src/test/setup/host.ts')],
                },
            },
            {
                test: {
                    name: 'repo',
                    environment: 'node',
                    include: ['src/test/repo/**/*.test.ts'],
                    testTimeout: 60_000,
                },
            },
        ],
    },
});
