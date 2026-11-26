import { hostEvent } from './events';
import { getWorkspaceFolder } from './folders';

import type { Disposable } from './events';
import type { FakeWorkspaceFolder } from './folders';
import type { Uri } from './uri';

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

export type SettingScope = 'global' | 'workspace' | Uri;

export interface ConfigurationChangeEvent {
    affectsConfiguration(section: string, scope?: unknown): boolean;
}

export interface ConfigurationUpdate {
    readonly key: string;
    readonly value: unknown;
    readonly target: number;
    readonly folder?: string;
}

export interface ConfigurationRead {
    readonly section: string | undefined;
    readonly scope: string | undefined;
}

const globalValues = new Map<string, unknown>();
const workspaceValues = new Map<string, unknown>();
const folderValues = new Map<string, Map<string, unknown>>();
let updates: ConfigurationUpdate[] = [];
let reads: ConfigurationRead[] = [];
const configurationChanged = hostEvent<ConfigurationChangeEvent>('workspace.onDidChangeConfiguration');

function valuesOf(folder: FakeWorkspaceFolder): Map<string, unknown> {
    const key = folder.uri.toString();
    let values = folderValues.get(key);
    if (!values) {
        values = new Map();
        folderValues.set(key, values);
    }
    return values;
}

function storeFor(scope: SettingScope): Map<string, unknown> {
    if (scope === 'global') {
        return globalValues;
    }
    if (scope === 'workspace') {
        return workspaceValues;
    }
    const folder = getWorkspaceFolder(scope);
    if (!folder) {
        throw new Error(`${scope.toString()} is not in a workspace folder`);
    }
    return valuesOf(folder);
}

function write(store: Map<string, unknown>, key: string, value: unknown): void {
    if (value === undefined) {
        store.delete(key);
    } else {
        store.set(key, structuredClone(value));
    }
}

function copy<T>(value: unknown): T | undefined {
    return value === undefined ? undefined : structuredClone(value) as T;
}

export function configurationChange(...keys: string[]): ConfigurationChangeEvent {
    return {
        affectsConfiguration: (section: string) =>
            keys.some(key => key === section || key.startsWith(`${section}.`) || section.startsWith(`${key}.`)),
    };
}

function resolveTarget(target: number | boolean | null | undefined): number {
    if (target === true || target === ConfigurationTarget.Global) {
        return ConfigurationTarget.Global;
    }
    return target === ConfigurationTarget.WorkspaceFolder ? ConfigurationTarget.WorkspaceFolder : ConfigurationTarget.Workspace;
}

export function getConfiguration(section?: string, scope?: Uri | null) {
    reads.push({ section, scope: scope?.toString() });
    const folder = scope ? getWorkspaceFolder(scope) : undefined;
    const qualified = (key: string): string => (section === undefined ? key : `${section}.${key}`);
    const folderValue = (key: string): unknown => (folder ? folderValues.get(folder.uri.toString())?.get(key) : undefined);
    return {
        get: <T>(key: string, defaultValue?: T): T | undefined => {
            const full = qualified(key);
            const value = [folderValue(full), workspaceValues.get(full), globalValues.get(full)].find(layer => layer !== undefined);
            return value === undefined ? defaultValue : copy<T>(value);
        },
        inspect: <T>(key: string) => {
            const full = qualified(key);
            return {
                key: full,
                globalValue: copy<T>(globalValues.get(full)),
                workspaceValue: copy<T>(workspaceValues.get(full)),
                workspaceFolderValue: copy<T>(folderValue(full)),
            };
        },
        update: (key: string, value: unknown, target?: number | boolean | null): Promise<void> => {
            const full = qualified(key);
            const resolved = resolveTarget(target);
            if (resolved === ConfigurationTarget.Global) {
                write(globalValues, full, value);
                updates.push({ key: full, value, target: resolved });
            } else if (resolved === ConfigurationTarget.Workspace) {
                write(workspaceValues, full, value);
                updates.push({ key: full, value, target: resolved });
            } else if (folder) {
                write(valuesOf(folder), full, value);
                updates.push({ key: full, value, target: resolved, folder: folder.uri.path });
            } else {
                return Promise.reject(new Error('Unable to write to Folder Settings because no resource is provided.'));
            }
            configurationChanged.fire(configurationChange(full));
            return Promise.resolve();
        },
    };
}

export function onDidChangeConfiguration(listener: (event: ConfigurationChangeEvent) => unknown): Disposable {
    return configurationChanged.add(listener);
}

export function setSetting(key: string, value: unknown, scope: SettingScope = 'workspace'): void {
    write(storeFor(scope), key, value);
}

export function changeSetting(key: string, value: unknown, scope: SettingScope = 'workspace'): void {
    setSetting(key, value, scope);
    fireConfigurationChange(key);
}

export function fireConfigurationChange(...keys: string[]): void {
    configurationChanged.fire(configurationChange(...keys));
}

export function flushConfigurationUpdates(): ConfigurationUpdate[] {
    return updates.splice(0);
}

export function flushConfigurationReads(): ConfigurationRead[] {
    return reads.splice(0);
}

export function resetConfiguration(): void {
    globalValues.clear();
    workspaceValues.clear();
    folderValues.clear();
    updates = [];
    reads = [];
}
