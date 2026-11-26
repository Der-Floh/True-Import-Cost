import path from 'node:path';
import { rspack } from '@rspack/core';
import webpack from 'webpack';

import { FIXTURES } from './support';

import type { RspackOptions, RspackPluginInstance } from '@rspack/core';
import type { Configuration, WebpackPluginInstance } from 'webpack';

export const WEBPACK_FIXTURE = path.join(FIXTURES, 'webpack-app');

export const BUNDLERS = ['webpack', 'rspack'] as const;

export type Bundler = typeof BUNDLERS[number];

export type FixturePlugin = WebpackPluginInstance & RspackPluginInstance;

export interface FixtureBuild {
    readonly outputPath: string;
    readonly plugins?: readonly FixturePlugin[];
    readonly mode?: 'production' | 'development';
    readonly devtool?: 'hidden-source-map' | false;
    readonly clean?: boolean;
    readonly name?: string;
    readonly entry?: string;
    readonly filename?: string;
}

interface CompilerHandle {
    run(callback: (error: Error | null, stats?: { hasErrors(): boolean; toString(options: object): string }) => void): void;
    close(callback: (error?: Error | null) => void): void;
}

function sharedConfig(build: FixtureBuild) {
    return {
        context: WEBPACK_FIXTURE,
        mode: build.mode ?? 'production',
        target: 'node',
        entry: { extension: build.entry ?? './src/extension.js' },
        output: { path: build.outputPath, filename: build.filename ?? '[name].js', library: { type: 'commonjs2' }, clean: build.clean ?? false },
        externals: { vscode: 'commonjs vscode' },
        devtool: build.devtool ?? false,
        infrastructureLogging: { level: 'error' },
        ...(build.name === undefined ? {} : { name: build.name }),
    } as const;
}

function run(compiler: CompilerHandle): Promise<void> {
    return new Promise((resolve, reject) => {
        compiler.run((error, stats) => {
            const failure = error ?? (stats?.hasErrors() ? new Error(stats.toString({ all: false, errors: true })) : undefined);
            compiler.close(() => (failure ? reject(failure) : resolve()));
        });
    });
}

export function buildFixture(bundler: Bundler, build: FixtureBuild): Promise<void> {
    if (bundler === 'webpack') {
        const config: Configuration = { ...sharedConfig(build), plugins: [...(build.plugins ?? [])] };
        return run(webpack(config));
    }
    const config: RspackOptions = { ...sharedConfig(build), plugins: [...(build.plugins ?? [])] };
    return run(rspack(config));
}

export function bundlerVersion(bundler: Bundler): string {
    return bundler === 'webpack' ? webpack.version : rspack.rspackVersion;
}
