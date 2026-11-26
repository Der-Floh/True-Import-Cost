import * as vscode from 'vscode';

import { MAX_DOCUMENT_LENGTH } from './documentAnalyzer';
import { Logger } from './logger';
import { loadParser } from './parserHost';

import type { LoadedTarget } from './metadataLoader';
import type { ExportResolver } from '../../core/attribution/barrels';
import type { ExportAnalysis } from '../../parser';

const UNKNOWN: ExportAnalysis = { kind: 'unknown' };

const ES_MODULE_FILE = /\.m?[jt]sx?$/i;

function fileOf(target: LoadedTarget, moduleId: string): vscode.Uri | undefined {
    const module = target.graph.module(moduleId);
    return module === undefined || module.virtual === true || !ES_MODULE_FILE.test(module.path)
        ? undefined
        : vscode.Uri.joinPath(target.baseUri, module.path);
}

async function readExports(uri: vscode.Uri): Promise<ExportAnalysis> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_DOCUMENT_LENGTH) {
            return UNKNOWN;
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength > MAX_DOCUMENT_LENGTH) {
            return UNKNOWN;
        }
        const parser = await loadParser();
        return parser.analyzeExports('', uri.path, new TextDecoder().decode(bytes));
    } catch (error: unknown) {
        Logger.debug(`Could not read the exports of ${uri.toString()}: ${error instanceof Error ? error.message : String(error)}`);
        return UNKNOWN;
    }
}

export class BarrelExports {
    private readonly loaded = new Map<string, ExportAnalysis>();
    private readonly loading = new Map<string, Promise<void>>();
    private generation = 0;

    public resolver(target: LoadedTarget, missing?: Set<string>): ExportResolver {
        return (moduleId) => {
            const file = fileOf(target, moduleId);
            if (file === undefined) {
                return UNKNOWN;
            }
            const analysis = this.loaded.get(file.toString());
            if (analysis === undefined) {
                missing?.add(moduleId);
            }
            return analysis;
        };
    }

    public async load(target: LoadedTarget, moduleIds: Iterable<string>): Promise<void> {
        await Promise.all([...moduleIds].map(moduleId => this.loadFile(fileOf(target, moduleId))));
    }

    public clear(): void {
        this.generation++;
        this.loaded.clear();
        this.loading.clear();
    }

    private loadFile(file: vscode.Uri | undefined): Promise<void> {
        if (file === undefined) {
            return Promise.resolve();
        }
        const key = file.toString();
        let pending = this.loading.get(key);
        if (!pending) {
            const generation = this.generation;
            pending = readExports(file).then((analysis) => {
                if (generation === this.generation) {
                    this.loaded.set(key, analysis);
                }
            });
            this.loading.set(key, pending);
        }
        return pending;
    }
}
