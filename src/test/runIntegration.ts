import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';
import * as esbuild from 'esbuild';

import { trueImportCost } from '../plugins/esbuild';

async function prepareWorkspace(root: string): Promise<string> {
    const fixture = path.join(root, 'src', 'test', 'fixtures', 'projects', 'esbuild-node');
    const workspace = path.join(root, 'out', 'test', 'workspace', 'esbuild-node');
    rmSync(workspace, { recursive: true, force: true });
    cpSync(fixture, workspace, { recursive: true });
    await esbuild.build({
        absWorkingDir: workspace,
        entryPoints: ['src/extension.ts'],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        minify: true,
        external: ['vscode'],
        outfile: 'dist/extension.js',
        logLevel: 'silent',
        plugins: [trueImportCost({ target: 'extension-host' })],
    });
    return workspace;
}

async function main(): Promise<void> {
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const extensionTestsPath = path.resolve(__dirname, './integration/index.js');
    const workspace = await prepareWorkspace(extensionDevelopmentPath);

    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: [workspace, '--disable-extensions'],
    });
}

main().catch((error: unknown) => {
    process.exitCode = 1;
    throw error instanceof Error ? error : new Error(String(error));
});
