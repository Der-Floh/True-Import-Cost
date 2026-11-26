import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { ESBUILD_FIXTURE } from './support';
import { STANDALONE_ENV, STANDALONE_VERSION } from '../../core/standaloneProtocol';
import { entrySource, measureStandalone } from '../../driver/standalone';
import { runBuild } from '../../extension/measure/buildRunner';

import type { StandaloneJob, StandaloneNames } from '../../core/standaloneProtocol';

const ROOT = path.resolve(ESBUILD_FIXTURE, '../../../../..');

const directories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'true-import-cost-standalone-'));
    directories.push(directory);
    return directory;
}

function job(specifier: string, names: StandaloneNames, platform: StandaloneJob['platform'] = 'browser'): StandaloneJob {
    return { version: STANDALONE_VERSION, cwd: ESBUILD_FIXTURE, specifier, names, platform, resultFile: path.join(temporaryDirectory(), 'result.json') };
}

afterAll(() => {
    for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('the entry a standalone size is measured from', () => {
    it.each([
        [['parse', 'default'], 'export { parse, default } from "big-library";\n'],
        ['all', 'import * as everything from "big-library";\nexport default everything;\n'],
        [['not a name'], 'import * as everything from "big-library";\nexport default everything;\n'],
    ] as const)('re-exports %j', (names, source) => {
        expect(entrySource('big-library', names)).toBe(source);
    });
});

describe('measuring a package by itself', () => {
    it.each(['esbuild', 'rolldown'] as const)('bundles the whole package, and only the names an import uses, with %s', async (bundler) => {
        const result = await measureStandalone(job('big-library', ['parse']), [bundler]);

        expect(result).toMatchObject({ ok: true, bundler: expect.stringMatching(new RegExp(`^${bundler} \\d`)) as unknown });
        const sizes = result.ok ? result : undefined;
        expect(sizes?.imported?.bytes).toBeGreaterThan(0);
        expect(sizes?.imported?.bytes).toBeLessThan(sizes?.whole.bytes ?? 0);
        expect(sizes?.whole.gzipBytes).toBeGreaterThan(0);
    });

    it('measures only the whole package for an import without names', async () => {
        const result = await measureStandalone(job('big-library', 'all'));

        expect(result.ok && result.imported).toBeUndefined();
        expect(result.ok && result.whole.bytes).toBeGreaterThan(0);
    });

    it('says when the package cannot be bundled', async () => {
        const result = await measureStandalone(job('not-installed-anywhere', 'all'));

        expect(result).toMatchObject({ ok: false, error: expect.stringContaining('not-installed-anywhere') as unknown });
    });

    it('runs as a process of its own and writes its result to the file the job names', async () => {
        const driver = path.join(ROOT, 'out', 'standalone.js');
        expect(existsSync(driver), 'the driver is built (npm run bundle)').toBe(true);
        const measured = job('big-library', ['validate'], 'node');
        const jobFile = path.join(temporaryDirectory(), 'job.json');
        writeFileSync(jobFile, JSON.stringify(measured));

        const outcome = await runBuild({ command: `${JSON.stringify(process.execPath)} ${JSON.stringify(driver)}`, cwd: ESBUILD_FIXTURE, env: { [STANDALONE_ENV]: jobFile, ELECTRON_RUN_AS_NODE: '1' }, timeoutMs: 60_000 });

        expect(outcome).toEqual({ status: 'succeeded' });
        expect(JSON.parse(readFileSync(measured.resultFile, 'utf8'))).toMatchObject({ ok: true, bundler: expect.stringMatching(/^esbuild /) as unknown });
    });
});
