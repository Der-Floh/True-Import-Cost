import * as vscode from 'vscode';

import { SETTINGS_SECTION } from '../constants';

export interface TargetSetting {
    readonly id?: string;
    readonly metadata: string;
    readonly root?: string;
}

export interface DisplaySettings {
    readonly exclusive: boolean;
    readonly external: boolean;
    readonly typeOnly: boolean;
    readonly unresolved: boolean;
}

export interface Settings {
    readonly enabled: boolean;
    readonly inlayHints: boolean;
    readonly display: DisplaySettings;
    readonly usageAnalysis: boolean;
    readonly debounceMs: number;
    readonly duplicateDiagnostics: boolean;
}

export interface FolderSettings {
    readonly targets: readonly TargetSetting[];
    readonly autoDiscover: boolean;
    readonly maxMetadataBytes: number;
}

const Key = {
    enabled: 'enabled',
    inlayHints: 'inlayHints.enabled',
    targets: 'targets',
    autoDiscover: 'autoDiscover',
    displayExclusive: 'display.exclusive',
    displayExternal: 'display.external',
    displayTypeOnly: 'display.typeOnly',
    displayUnresolved: 'display.unresolved',
    usageAnalysis: 'analysis.usageAnalysis',
    debounceMs: 'analysis.debounceMs',
    duplicateDiagnostics: 'diagnostics.duplicatePackages',
    maxMetadataSizeMB: 'maxMetadataSizeMB',
} as const;

const DEFAULT_DEBOUNCE_MS = 300;
const MAX_DEBOUNCE_MS = 5000;
const DEFAULT_MAX_METADATA_MB = 64;
const MAX_METADATA_MB = 1024;
const MAX_TARGETS = 50;

function readBoolean(configuration: vscode.WorkspaceConfiguration, key: string, fallback: boolean): boolean {
    const value: unknown = configuration.get(key);
    return typeof value === 'boolean' ? value : fallback;
}

function readNumber(configuration: vscode.WorkspaceConfiguration, key: string, fallback: number, minimum: number, maximum: number): number {
    const value: unknown = configuration.get(key);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(maximum, Math.max(minimum, value));
}

function optionalText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readTargets(configuration: vscode.WorkspaceConfiguration): TargetSetting[] {
    const value: unknown = configuration.get(Key.targets);
    if (!Array.isArray(value)) {
        return [];
    }
    const targets: TargetSetting[] = [];
    for (const entry of value.slice(0, MAX_TARGETS)) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const metadata = optionalText(record.metadata);
        if (metadata === undefined) {
            continue;
        }
        const id = optionalText(record.id);
        const root = optionalText(record.root);
        targets.push({ metadata, ...(id === undefined ? {} : { id }), ...(root === undefined ? {} : { root }) });
    }
    return targets;
}

export function readSettings(): Settings {
    const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION);
    return {
        enabled: readBoolean(configuration, Key.enabled, true),
        inlayHints: readBoolean(configuration, Key.inlayHints, true),
        display: {
            exclusive: readBoolean(configuration, Key.displayExclusive, true),
            external: readBoolean(configuration, Key.displayExternal, true),
            typeOnly: readBoolean(configuration, Key.displayTypeOnly, false),
            unresolved: readBoolean(configuration, Key.displayUnresolved, true),
        },
        usageAnalysis: readBoolean(configuration, Key.usageAnalysis, true),
        debounceMs: Math.round(readNumber(configuration, Key.debounceMs, DEFAULT_DEBOUNCE_MS, 0, MAX_DEBOUNCE_MS)),
        duplicateDiagnostics: readBoolean(configuration, Key.duplicateDiagnostics, true),
    };
}

export function readFolderSettings(folder: vscode.WorkspaceFolder): FolderSettings {
    const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION, folder.uri);
    const megabytes = readNumber(configuration, Key.maxMetadataSizeMB, DEFAULT_MAX_METADATA_MB, 1, MAX_METADATA_MB);
    return {
        targets: readTargets(configuration),
        autoDiscover: readBoolean(configuration, Key.autoDiscover, true),
        maxMetadataBytes: Math.round(megabytes * 1024 * 1024),
    };
}

export function affectsSettings(event: vscode.ConfigurationChangeEvent): boolean {
    return event.affectsConfiguration(SETTINGS_SECTION);
}

export function affectsMetadataLocation(event: vscode.ConfigurationChangeEvent): boolean {
    return [Key.targets, Key.autoDiscover, Key.maxMetadataSizeMB, Key.enabled]
        .some(key => event.affectsConfiguration(`${SETTINGS_SECTION}.${key}`));
}

export async function setInlayHintsEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration(SETTINGS_SECTION).update(Key.inlayHints, enabled, vscode.ConfigurationTarget.Global);
}

export async function addTargetSetting(folder: vscode.WorkspaceFolder, target: TargetSetting): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION, folder.uri);
    const existing = configuration.inspect<unknown[]>(Key.targets)?.workspaceFolderValue;
    const current = Array.isArray(existing) ? existing : [];
    const remaining = current.filter((entry) => {
        const metadata = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>).metadata : undefined;
        return metadata !== target.metadata;
    });
    await configuration.update(Key.targets, [...remaining, target], vscode.ConfigurationTarget.WorkspaceFolder);
}
