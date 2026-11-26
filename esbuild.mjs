import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');
const production = process.argv.includes('--production');

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        const target = build.initialOptions.outfile;
        build.onStart(() => {
            console.log(`[watch] build started (${target})`);
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                if (location) {
                    console.error(`    ${location.file}:${location.line}:${location.column}:`);
                }
            });
            console.log(`[watch] build finished (${target})`);
        });
    },
};

// TypeScript and the Vue compiler are megabytes of JavaScript. Loading them on activation would cost
// most of the activation budget, so the parser is its own bundle that the host requires on first use.
/** @type {import('esbuild').Plugin} */
const lazyParserPlugin = {
    name: 'lazy-parser',

    setup(build) {
        build.onResolve({ filter: /[\\/]parser([\\/]index(\.js)?)?$/ }, (args) => {
            if (args.kind !== 'dynamic-import') {
                return undefined;
            }
            return { path: './parser.js', external: true };
        });
    },
};

/** @type {import('esbuild').BuildOptions} */
const shared = {
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    external: ['vscode'],
    define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
    logLevel: 'silent',
};

const targets = [
    { ...shared, entryPoints: ['src/extension/extension.ts'], outfile: 'out/extension.js', supported: { 'dynamic-import': false }, plugins: [lazyParserPlugin] },
    { ...shared, entryPoints: ['src/parser/index.ts'], outfile: 'out/parser.js', plugins: [] },
    { ...shared, entryPoints: ['src/driver/standaloneMain.ts'], outfile: 'out/standalone.js', plugins: [] },
    { ...shared, entryPoints: ['src/driver/metadataWorker.ts'], outfile: 'out/metadataWorker.js', plugins: [] },
];

async function buildTests() {
    /** @type {import('esbuild').BuildOptions} */
    const base = {
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        sourcemap: true,
        sourcesContent: false,
        logLevel: 'silent',
    };

    await Promise.all([
        esbuild.build({
            ...base,
            entryPoints: ['src/test/runIntegration.ts'],
            outfile: 'out/test/runIntegration.js',
            external: ['vscode', '@vscode/test-electron', 'esbuild'],
        }),
        esbuild.build({
            ...base,
            entryPoints: ['src/test/integration/index.ts'],
            outfile: 'out/test/integration/index.js',
            external: ['vscode'],
        }),
    ]);
}

async function main() {
    if (tests) {
        await buildTests();
        return;
    }

    const contexts = await Promise.all(
        targets.map(({ plugins, ...options }) => esbuild.context({ ...options, plugins: [...plugins, esbuildProblemMatcherPlugin] })),
    );

    if (watch) {
        await Promise.all(contexts.map(ctx => ctx.watch()));
        return;
    }

    await Promise.all(contexts.map(ctx => ctx.rebuild()));
    await Promise.all(contexts.map(ctx => ctx.dispose()));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
