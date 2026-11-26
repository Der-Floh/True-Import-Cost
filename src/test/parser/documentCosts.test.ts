import { describe, expect, it } from 'vitest';

import { BUILD_CONTEXT, dynamicImport, externalImport, importOf, input, metafile, output, statement } from '../core/support/esbuild';
import { normalizeEsbuildMetafile } from '../../core/adapters/esbuild';
import { attributeImport, locateDocument } from '../../core/attribution/attribute';
import { BuildGraph } from '../../core/graph/buildGraph';
import { analyzeDocument } from '../../parser';

import type { ImportCost, ImportQuery } from '../../core/attribution/attribute';
import type { SourceImport } from '../../parser';

const EXTENSION = `import * as vscode from 'vscode';
import { registerCommands } from './commands';
import debounce from 'lodash-es/debounce';
import * as path from './path';
import config from './config';
import { unusedHelper } from './unused';
import { Shape } from './shapes';
import type { Settings } from './settings';
import { type Range, type Position } from './types';
import './polyfill';
import ts from 'typescript';
export type { Options } from './options';
export { api } from './api';

export async function activate(settings: Settings, shape: Shape, at: Range | Position): Promise<void> {
    registerCommands(vscode.commands);
    const save = debounce(() => config.get('save'), 100);
    vscode.window.showInformationMessage(path.join('a', 'b'));
    const heavy = await import('./heavy');
    heavy.run(save);
}
`;

const LEGACY = `import { unusedHelper } from './unused';
import { gone } from './gone';
const fs = require('fs');
module.exports = () => fs.readFileSync('x');
`;

const GRAPH = new BuildGraph(normalizeEsbuildMetafile(metafile(
    {
        'src/extension.ts': input(3000, [
            externalImport('vscode'),
            statement('src/commands.ts', './commands'),
            statement('node_modules/lodash-es/debounce.js', 'lodash-es/debounce'),
            statement('src/path.ts', './path'),
            statement('src/config.ts', './config'),
            externalImport('./unused'),
            externalImport('./shapes'),
            statement('src/polyfill.ts', './polyfill'),
            externalImport('typescript'),
            statement('src/api.ts', './api'),
            dynamicImport('src/heavy.ts', './heavy'),
        ]),
        'src/legacy.js': input(200, [statement('src/unused.ts', './unused'), externalImport('fs', 'require-call')]),
        'src/commands.ts': input(900),
        'node_modules/lodash-es/debounce.js': input(2400),
        'src/path.ts': input(500),
        'src/config.ts': input(300),
        'src/unused.ts': input(700),
        'src/polyfill.ts': input(150),
        'src/api.ts': input(250),
        'src/heavy.ts': input(9000),
    },
    {
        'dist/extension.js': output({
            'src/extension.ts': 1200,
            'src/legacy.js': 90,
            'src/commands.ts': 600,
            'node_modules/lodash-es/debounce.js': 800,
            'src/path.ts': 350,
            'src/config.ts': 120,
            'src/unused.ts': 0,
            'src/polyfill.ts': 80,
            'src/api.ts': 140,
        }, {
            entryPoint: 'src/extension.ts',
            imports: [externalImport('vscode', 'require-call'), externalImport('fs', 'require-call'), importOf('dist/heavy-3K.js', 'dynamic-import')],
        }),
        'dist/heavy-3K.js': output({ 'src/heavy.ts': 4000 }, { entryPoint: 'src/heavy.ts' }),
    },
), BUILD_CONTEXT));

function toQuery(source: SourceImport): ImportQuery {
    const kind = source.kind === 'dynamic'
        ? 'dynamic'
        : source.kind === 'require' || source.kind === 'import-equals'
            ? 'require'
            : source.kind === 're-export' || source.kind === 'export-all' ? 're-export' : 'static';
    return {
        specifier: source.specifier,
        kind,
        typeOnly: source.typeOnly,
        sideEffectOnly: source.kind === 'side-effect',
        ...(source.hasValueUsage === undefined ? {} : { hasValueUsage: source.hasValueUsage }),
    };
}

function costsOf(languageId: string, documentPath: string, text: string): Map<string, ImportCost> {
    const location = locateDocument(GRAPH, documentPath);
    if (!location) {
        throw new Error(`the build has no module at "${documentPath}"`);
    }
    const { imports } = analyzeDocument(languageId, documentPath, text, { usage: true });
    return new Map(imports.map(source => [source.specifier, attributeImport(location, toQuery(source))]));
}

describe('import costs of a parsed TypeScript document', () => {
    const costs = costsOf('typescript', 'src/extension.ts', EXTENSION);
    const status = (specifier: string) => costs.get(specifier)?.status;

    it('reports named, default and namespace imports as bundled', () => {
        expect(['./commands', 'lodash-es/debounce', './config', './path'].map(status)).toEqual(['bundled', 'bundled', 'bundled', 'bundled']);
    });

    it('reports a side-effect import and a value re-export as bundled', () => {
        expect([status('./polyfill'), status('./api')]).toEqual(['bundled', 'bundled']);
    });

    it('reports an import the compiler elides because it is unused or only used as a type as elided', () => {
        expect([status('./unused'), status('./shapes'), status('typescript')]).toEqual(['elided', 'elided', 'elided']);
    });

    it('reports import type, all-inline type specifiers and export type as type-only', () => {
        expect([status('./settings'), status('./types'), status('./options')]).toEqual(['type-only', 'type-only', 'type-only']);
    });

    it('reports a retained external dependency as external', () => {
        expect(costs.get('vscode')).toMatchObject({ status: 'external', specifier: 'vscode' });
    });

    it('reports a dynamic import as lazy', () => {
        expect(costs.get('./heavy')).toMatchObject({ status: 'bundled', lazy: true, impact: { bundledBytes: 4000 } });
    });
});

describe('import costs of a parsed JavaScript document', () => {
    const costs = costsOf('javascript', 'src/legacy.js', LEGACY);

    it('reports an unused import whose module the bundler tree-shook as tree-shaken', () => {
        expect(costs.get('./unused')).toMatchObject({ status: 'tree-shaken', impact: { bundledBytes: 0 } });
    });

    it('reports a required external module as external', () => {
        expect(costs.get('fs')?.status).toBe('external');
    });

    it('reports an import the build has no record of as unresolved', () => {
        expect(costs.get('./gone')?.status).toBe('unresolved');
    });
});
