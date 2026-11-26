import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import manifest from '../../../package.json';
import {
    addTargetSetting,
    affectsMetadataLocation,
    affectsSettings,
    readFolderSettings,
    readSettings,
    setInlayHintsEnabled,
} from '../../extension/services/settings';
import { configurationChange, flushConfigurationReads, flushConfigurationUpdates, setSetting, setWorkspaceFolders } from '../__mocks__/vscode';

import type { FakeWorkspaceFolder } from '../__mocks__/vscode';

const declared = manifest.contributes.configuration.properties;
const MB = 1024 * 1024;

let folder: FakeWorkspaceFolder;

beforeEach(() => {
    [folder] = setWorkspaceFolders('/w') as [FakeWorkspaceFolder];
});

describe('readSettings', () => {
    it('falls back to the defaults package.json declares when nothing is set', () => {
        expect(readSettings()).toEqual({
            enabled: declared['trueImportCost.enabled'].default,
            inlayHints: declared['trueImportCost.inlayHints.enabled'].default,
            display: {
                exclusive: declared['trueImportCost.display.exclusive'].default,
                external: declared['trueImportCost.display.external'].default,
                typeOnly: declared['trueImportCost.display.typeOnly'].default,
                unresolved: declared['trueImportCost.display.unresolved'].default,
            },
            usageAnalysis: declared['trueImportCost.analysis.usageAnalysis'].default,
            debounceMs: declared['trueImportCost.analysis.debounceMs'].default,
            duplicateDiagnostics: declared['trueImportCost.diagnostics.duplicatePackages'].default,
            budgets: new Map(),
            historyEnabled: declared['trueImportCost.history.enabled'].default,
        });
    });

    it('reads every window setting', () => {
        setSetting('trueImportCost.enabled', false);
        setSetting('trueImportCost.inlayHints.enabled', false);
        setSetting('trueImportCost.display.exclusive', false);
        setSetting('trueImportCost.display.external', false);
        setSetting('trueImportCost.display.typeOnly', true);
        setSetting('trueImportCost.display.unresolved', false);
        setSetting('trueImportCost.analysis.usageAnalysis', false);
        setSetting('trueImportCost.analysis.debounceMs', 50);
        setSetting('trueImportCost.diagnostics.duplicatePackages', false);
        setSetting('trueImportCost.budgets', { webview: { initial: '600 kB', packages: { moment: 0 } } });
        setSetting('trueImportCost.history.enabled', false);

        expect(readSettings()).toEqual({
            enabled: false,
            inlayHints: false,
            display: { exclusive: false, external: false, typeOnly: true, unresolved: false },
            usageAnalysis: false,
            debounceMs: 50,
            duplicateDiagnostics: false,
            budgets: new Map([['webview', { initial: 600_000, packages: new Map([['moment', 0]]) }]]),
            historyEnabled: false,
        });
    });

    it('reads the user settings the same as the workspace settings', () => {
        setSetting('trueImportCost.display.typeOnly', true, 'global');

        expect(readSettings().display.typeOnly).toBe(true);
    });

    it('ignores a value of the wrong type and keeps the default', () => {
        setSetting('trueImportCost.enabled', 'false');
        setSetting('trueImportCost.inlayHints.enabled', 0);
        setSetting('trueImportCost.display.typeOnly', 'yes');
        setSetting('trueImportCost.diagnostics.duplicatePackages', null);
        setSetting('trueImportCost.analysis.debounceMs', '100');

        const settings = readSettings();

        expect(settings.enabled).toBe(true);
        expect(settings.inlayHints).toBe(true);
        expect(settings.display.typeOnly).toBe(false);
        expect(settings.duplicateDiagnostics).toBe(true);
        expect(settings.debounceMs).toBe(declared['trueImportCost.analysis.debounceMs'].default);
    });

    it('clamps the debounce to the range package.json declares, in whole milliseconds', () => {
        const { minimum, maximum } = declared['trueImportCost.analysis.debounceMs'];

        setSetting('trueImportCost.analysis.debounceMs', -50);
        expect(readSettings().debounceMs).toBe(minimum);

        setSetting('trueImportCost.analysis.debounceMs', 99_999);
        expect(readSettings().debounceMs).toBe(maximum);

        setSetting('trueImportCost.analysis.debounceMs', 120.6);
        expect(readSettings().debounceMs).toBe(121);
    });

    it('ignores a debounce that is not a finite number', () => {
        setSetting('trueImportCost.analysis.debounceMs', Number.POSITIVE_INFINITY);
        expect(readSettings().debounceMs).toBe(declared['trueImportCost.analysis.debounceMs'].default);

        setSetting('trueImportCost.analysis.debounceMs', Number.NaN);
        expect(readSettings().debounceMs).toBe(declared['trueImportCost.analysis.debounceMs'].default);
    });
});

describe('readFolderSettings', () => {
    it('reads the settings of the folder it is given, for that folder', () => {
        readFolderSettings(folder);

        expect(flushConfigurationReads()).toEqual([{ section: 'trueImportCost', scope: folder.uri.toString() }]);
    });

    it('falls back to the defaults package.json declares when nothing is set', () => {
        expect(readFolderSettings(folder)).toEqual({
            targets: declared['trueImportCost.targets'].default,
            autoDiscover: declared['trueImportCost.autoDiscover'].default,
            maxMetadataBytes: declared['trueImportCost.maxMetadataSizeMB'].default * MB,
        });
    });

    it("prefers the folder's own value to the workspace's", () => {
        setSetting('trueImportCost.autoDiscover', true);
        setSetting('trueImportCost.autoDiscover', false, folder.uri);

        expect(readFolderSettings(folder).autoDiscover).toBe(false);
    });

    it('turns the size limit into bytes, clamped to the range package.json declares', () => {
        const { minimum, maximum } = declared['trueImportCost.maxMetadataSizeMB'];

        setSetting('trueImportCost.maxMetadataSizeMB', 0.25);
        expect(readFolderSettings(folder).maxMetadataBytes).toBe(minimum * MB);

        setSetting('trueImportCost.maxMetadataSizeMB', 4096);
        expect(readFolderSettings(folder).maxMetadataBytes).toBe(maximum * MB);

        setSetting('trueImportCost.maxMetadataSizeMB', 1.5);
        expect(readFolderSettings(folder).maxMetadataBytes).toBe(1.5 * MB);

        setSetting('trueImportCost.maxMetadataSizeMB', '8');
        expect(readFolderSettings(folder).maxMetadataBytes).toBe(declared['trueImportCost.maxMetadataSizeMB'].default * MB);
    });

    it('keeps the targets that name a metadata file, trimmed, and drops the rest', () => {
        setSetting('trueImportCost.targets', [
            { id: ' web ', metadata: ' build/web.json ', root: ' packages/web ' },
            { id: '', metadata: 'build/node.json', root: '   ' },
            { id: 'no-metadata' },
            { metadata: '   ' },
            { metadata: 42 },
            'build/plain-string.json',
            null,
            ['build/in-a-list.json'],
        ]);

        expect(readFolderSettings(folder).targets).toEqual([
            { id: 'web', metadata: 'build/web.json', root: 'packages/web' },
            { metadata: 'build/node.json' },
        ]);
    });

    it('reads no more than 50 targets', () => {
        setSetting('trueImportCost.targets', Array.from({ length: 60 }, (_, index) => ({ metadata: `build/${index}.json` })));

        const targets = readFolderSettings(folder).targets;

        expect(targets).toHaveLength(50);
        expect(targets.at(-1)).toEqual({ metadata: 'build/49.json' });
    });

    it('reads no targets from a value that is not a list', () => {
        setSetting('trueImportCost.targets', { metadata: 'build/meta.json' });

        expect(readFolderSettings(folder).targets).toEqual([]);
    });
});

describe('affectsSettings', () => {
    it('is true for any setting of the extension', () => {
        expect(affectsSettings(configurationChange('trueImportCost.display.typeOnly'))).toBe(true);
        expect(affectsSettings(configurationChange('trueImportCost.targets'))).toBe(true);
    });

    it("is false for other extensions' settings", () => {
        expect(affectsSettings(configurationChange('editor.inlayHints.enabled', 'importCost.debug'))).toBe(false);
    });
});

describe('affectsMetadataLocation', () => {
    it('is true for the settings that decide which metadata is read', () => {
        for (const key of ['targets', 'autoDiscover', 'maxMetadataSizeMB', 'enabled']) {
            expect(affectsMetadataLocation(configurationChange(`trueImportCost.${key}`)), key).toBe(true);
        }
        expect(affectsMetadataLocation(configurationChange('trueImportCost'))).toBe(true);
    });

    it('is false for settings that only change how costs are shown', () => {
        for (const key of ['inlayHints.enabled', 'display.typeOnly', 'analysis.debounceMs', 'diagnostics.duplicatePackages']) {
            expect(affectsMetadataLocation(configurationChange(`trueImportCost.${key}`)), key).toBe(false);
        }
    });
});

describe('setInlayHintsEnabled', () => {
    it('writes the user setting, so it applies in every workspace', async () => {
        await setInlayHintsEnabled(false);

        expect(flushConfigurationUpdates()).toEqual([
            { key: 'trueImportCost.inlayHints.enabled', value: false, target: vscode.ConfigurationTarget.Global },
        ]);
        expect(readSettings().inlayHints).toBe(false);
    });
});

describe('addTargetSetting', () => {
    it("adds the target to the folder's own targets", async () => {
        setSetting('trueImportCost.targets', [{ id: 'node', metadata: 'build/node.json' }], folder.uri);

        await addTargetSetting(folder, { id: 'web', metadata: 'build/web.json' });

        expect(flushConfigurationUpdates()).toEqual([{
            key: 'trueImportCost.targets',
            value: [{ id: 'node', metadata: 'build/node.json' }, { id: 'web', metadata: 'build/web.json' }],
            target: vscode.ConfigurationTarget.WorkspaceFolder,
            folder: '/w',
        }]);
    });

    it('replaces a target for the same metadata file and keeps entries it cannot read', async () => {
        setSetting('trueImportCost.targets', ['hand-written', { id: 'old', metadata: 'build/web.json' }, { metadata: 'build/node.json' }], folder.uri);

        await addTargetSetting(folder, { id: 'web', metadata: 'build/web.json' });

        expect(readFolderSettings(folder).targets).toEqual([{ metadata: 'build/node.json' }, { id: 'web', metadata: 'build/web.json' }]);
        expect(vscode.workspace.getConfiguration('trueImportCost', folder.uri).inspect('targets')?.workspaceFolderValue).toEqual([
            'hand-written',
            { metadata: 'build/node.json' },
            { id: 'web', metadata: 'build/web.json' },
        ]);
    });
});
