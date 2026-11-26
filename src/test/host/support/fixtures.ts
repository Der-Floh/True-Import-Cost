import * as vscode from 'vscode';

import { setVirtualFile } from '../../__mocks__/vscode';
import { esbuildMetafile, externalImport, staticImport } from './metafile';
import { lines, writeJson, writePackageJson, writeSource } from './workspace';

import type { FakeTextDocument } from '../../__mocks__/vscode';
import type { EsbuildMetafile } from './metafile';

export const EXTENSION_HOST_METADATA = '/w/.true-import-cost/extension-host.json';

export const EXTENSION_HOST_KEY = vscode.Uri.file(EXTENSION_HOST_METADATA).toString();

export const EXTENSION_SOURCE = lines(
    "import * as vscode from 'vscode';",
    "import { chunk } from 'lodash';",
    "import { formatSize } from './format';",
    "import { log } from './log';",
    "import type { Options } from './options';",
    "import { unusedHelper } from './unused';",
    "import { Shape } from './shapes';",
    "import { fresh } from 'fresh-package';",
    '',
    'export function activate(options: Options): void {',
    '    const shape: Shape | undefined = undefined;',
    '    log(formatSize(chunk([1, 2, 3], 2).length), shape, fresh);',
    "    void vscode.window.showInformationMessage('ready');",
    '}',
);

export function extensionHostMetafile(lodashBytes = 70_000): EsbuildMetafile {
    return esbuildMetafile({
        entry: 'src/extension.ts',
        outfile: 'out/extension.js',
        inputs: {
            'src/extension.ts': {
                output: 1_200,
                imports: [
                    externalImport('vscode'),
                    staticImport('lodash', 'node_modules/lodash/lodash.js'),
                    staticImport('./format', 'src/format.ts'),
                    staticImport('./log', 'src/log.ts'),
                ],
            },
            'src/format.ts': { output: 800, imports: [staticImport('./log', 'src/log.ts'), staticImport('tslib', 'node_modules/tslib/tslib.es6.mjs')] },
            'src/log.ts': { output: 300 },
            'node_modules/lodash/lodash.js': { output: lodashBytes, imports: [staticImport('tslib', 'node_modules/tslib/tslib.es6.mjs')] },
            'node_modules/tslib/tslib.es6.mjs': { output: 2_000 },
        },
    });
}

export const DUPLICATE_METADATA = '/w/.true-import-cost/app.json';

export const DUPLICATE_KEY = vscode.Uri.file(DUPLICATE_METADATA).toString();

export const DUPLICATE_SOURCE = lines(
    "import { chunk } from 'lodash';",
    "import { renderWidget } from 'legacy-widget';",
    '',
    'renderWidget(chunk([1, 2], 1));',
);

export function writeDuplicatedLodash(): FakeTextDocument {
    writeJson(DUPLICATE_METADATA, esbuildMetafile({
        entry: 'src/main.ts',
        inputs: {
            'src/main.ts': {
                output: 400,
                imports: [staticImport('lodash', 'node_modules/lodash/lodash.js'), staticImport('legacy-widget', 'node_modules/legacy-widget/index.js')],
            },
            'node_modules/lodash/lodash.js': { output: 70_000 },
            'node_modules/legacy-widget/index.js': { output: 5_000, imports: [staticImport('lodash', 'node_modules/legacy-widget/node_modules/lodash/index.js')] },
            'node_modules/legacy-widget/node_modules/lodash/index.js': { output: 60_000 },
        },
    }));
    writePackageJson('/w/node_modules/lodash', '4.17.21');
    writePackageJson('/w/node_modules/legacy-widget', '2.0.0');
    writePackageJson('/w/node_modules/legacy-widget/node_modules/lodash', '3.10.1');
    return writeSource('/w/src/main.ts', DUPLICATE_SOURCE);
}

export interface FileTimes {
    readonly built?: number;
    readonly saved?: number;
}

export function writeExtensionHost(times: FileTimes = {}): FakeTextDocument {
    writeJson(EXTENSION_HOST_METADATA, extensionHostMetafile(), times.built === undefined ? {} : { mtime: times.built });
    writePackageJson('/w/node_modules/lodash', '4.17.21');
    writePackageJson('/w/node_modules/tslib', '2.8.1');
    setVirtualFile('/w/src/format.ts', 'export function formatSize(size: number): string { return String(size); }\n');
    setVirtualFile('/w/src/log.ts', 'export function log(...values: unknown[]): void { console.log(...values); }\n');
    return writeSource('/w/src/extension.ts', EXTENSION_SOURCE, times.saved === undefined ? {} : { mtime: times.saved });
}
