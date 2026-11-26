import * as vscode from 'vscode';

import { readFolderSettings } from './settings';
import { DISCOVERY_GLOB } from '../constants';
import { isAbsolutePath } from '../../core/paths';

import type { TargetSetting } from './settings';

export interface MetadataSource {
    readonly uri: vscode.Uri;
    readonly folder: vscode.WorkspaceFolder;
    readonly setting?: TargetSetting;
    readonly maxBytes: number;
}

const MAX_DISCOVERED_PER_FOLDER = 100;

export function resolveSettingPath(folder: vscode.WorkspaceFolder, path: string): vscode.Uri {
    return isAbsolutePath(path) ? vscode.Uri.file(path) : vscode.Uri.joinPath(folder.uri, path);
}

export async function locateMetadata(folders: readonly vscode.WorkspaceFolder[], enabled: boolean): Promise<MetadataSource[]> {
    if (!enabled) {
        return [];
    }
    const sources = new Map<string, MetadataSource>();
    for (const folder of folders) {
        const settings = readFolderSettings(folder);
        for (const setting of settings.targets) {
            const uri = resolveSettingPath(folder, setting.metadata);
            sources.set(uri.toString(), { uri, folder, setting, maxBytes: settings.maxMetadataBytes });
        }
        if (!settings.autoDiscover) {
            continue;
        }
        const discovered = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, DISCOVERY_GLOB),
            '**/node_modules/**',
            MAX_DISCOVERED_PER_FOLDER,
        );
        for (const uri of discovered) {
            if (!sources.has(uri.toString())) {
                sources.set(uri.toString(), { uri, folder, maxBytes: settings.maxMetadataBytes });
            }
        }
    }
    return [...sources.values()];
}
