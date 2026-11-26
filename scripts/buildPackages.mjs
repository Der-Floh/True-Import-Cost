import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGES = [
    { directory: 'packages/esbuild', entry: 'src/plugins/esbuild.ts', peers: ['esbuild'] },
    { directory: 'packages/vite', entry: 'src/plugins/vite.ts', peers: ['vite'] },
    { directory: 'packages/webpack', entry: 'src/plugins/webpack.ts', peers: ['webpack', '@rspack/core'], files: ['src/plugins/webpackLoader.cjs'] },
];

const COMMONJS_IMPORT_META = {
    inject: [path.join(ROOT, 'scripts/importMetaUrl.js')],
    define: { 'import.meta.url': 'importMetaUrl' },
};

function readCompilerOptions() {
    const configPath = path.join(ROOT, 'src/plugins/tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) {
        throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    }
    return ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath)).options;
}

function declarationOf(entry, compilerOptions) {
    const entryPath = path.join(ROOT, entry);
    const program = ts.createProgram([entryPath], {
        ...compilerOptions,
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: path.join(ROOT, 'out', 'declarations'),
        rootDir: ROOT,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
        throw new Error(ts.formatDiagnostics(diagnostics, {
            getCanonicalFileName: name => name,
            getCurrentDirectory: () => ROOT,
            getNewLine: () => '\n',
        }));
    }
    const wanted = path.join(ROOT, 'out', 'declarations', entry.replace(/\.ts$/, '.d.ts'));
    let text;
    program.emit(undefined, (fileName, content) => {
        if (path.resolve(fileName) === wanted) {
            text = content;
        }
    }, undefined, true);
    if (text === undefined) {
        throw new Error(`No declaration was emitted for ${entry}.`);
    }
    if (/from ['"]\.\.?\//.test(text)) {
        throw new Error(`The declaration of ${entry} refers to project files, so it would not resolve once published:\n${text}`);
    }
    return text;
}

async function buildPackage({ directory, entry, peers, files = [] }, compilerOptions) {
    const dist = path.join(ROOT, directory, 'dist');
    await rm(dist, { recursive: true, force: true });
    await mkdir(dist, { recursive: true });

    const shared = {
        entryPoints: [path.join(ROOT, entry)],
        bundle: true,
        platform: 'node',
        target: 'node18',
        external: peers,
        logLevel: 'warning',
        legalComments: 'none',
    };
    await Promise.all([
        esbuild.build({ ...shared, ...COMMONJS_IMPORT_META, format: 'cjs', outfile: path.join(dist, 'index.cjs') }),
        esbuild.build({ ...shared, format: 'esm', outfile: path.join(dist, 'index.mjs') }),
        ...files.map(file => copyFile(path.join(ROOT, file), path.join(dist, path.basename(file)))),
    ]);

    const declaration = declarationOf(entry, compilerOptions);
    await Promise.all([
        writeFile(path.join(dist, 'index.d.mts'), declaration),
        writeFile(path.join(dist, 'index.d.cts'), declaration),
    ]);
}

const CLI = { directory: 'packages/cli', entry: 'src/cli/main.ts', bin: 'dist/cli.cjs' };

async function buildCli({ directory, entry, bin }) {
    const dist = path.join(ROOT, directory, 'dist');
    await rm(dist, { recursive: true, force: true });
    await mkdir(dist, { recursive: true });
    const { version } = JSON.parse(await readFile(path.join(ROOT, directory, 'package.json'), 'utf8'));
    const outfile = path.join(ROOT, directory, bin);
    await esbuild.build({
        entryPoints: [path.join(ROOT, entry)],
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        outfile,
        banner: { js: '#!/usr/bin/env node' },
        define: { CLI_VERSION: JSON.stringify(version) },
        logLevel: 'warning',
        legalComments: 'none',
    });
    await chmod(outfile, 0o755);
}

const compilerOptions = readCompilerOptions();
await Promise.all([...PACKAGES.map(item => buildPackage(item, compilerOptions)), buildCli(CLI)]);
