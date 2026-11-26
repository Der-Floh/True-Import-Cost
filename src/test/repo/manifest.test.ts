import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { Command, SUPPORTED_LANGUAGES, View } from '../../extension/constants';

interface ConfigurationProperty {
    readonly default?: unknown;
    readonly markdownDescription?: string;
    readonly scope?: string;
}

interface Manifest {
    readonly name: string;
    readonly version: string;
    readonly engines: { readonly vscode: string };
    readonly main: string;
    readonly activationEvents: readonly string[];
    readonly files: readonly string[];
    readonly qna?: string | false;
    readonly homepage?: string;
    readonly repository?: { readonly url?: string };
    readonly bugs?: { readonly url?: string };
    readonly devDependencies: Readonly<Record<string, string>>;
    readonly capabilities?: {
        readonly untrustedWorkspaces?: { readonly supported?: unknown; readonly description?: string; readonly restrictedConfigurations?: readonly string[] };
        readonly virtualWorkspaces?: unknown;
    };
    readonly contributes: {
        readonly commands: readonly { readonly command: string; readonly title: string; readonly category?: string }[];
        readonly menus: Readonly<Record<string, readonly { readonly command: string }[]>>;
        readonly views: Readonly<Record<string, readonly { readonly id: string }[]>>;
        readonly viewsWelcome: readonly { readonly view: string }[];
        readonly configuration: { readonly properties: Readonly<Record<string, ConfigurationProperty>> };
    };
}

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), 'utf8');

const manifest = JSON.parse(read('package.json')) as Manifest;

const isHttpsUrl = (value: string | undefined): boolean => value !== undefined && URL.canParse(value) && new URL(value).protocol === 'https:';

const settingKeysReadByTheExtension = (): string[] => {
    const source = read('src/extension/services/settings.ts');
    const block = /const Key = \{([\s\S]*?)\} as const;/.exec(source)?.[1] ?? '';
    return [...block.matchAll(/:\s*'([^']+)'/g)].map(match => `trueImportCost.${match[1] ?? ''}`);
};

describe('the manifest, as the registries read it', () => {
    it('links the homepage, the repository, the issues and Q&A by URL', () => {
        for (const value of [manifest.homepage, manifest.repository?.url, manifest.bugs?.url, manifest.qna === false ? undefined : manifest.qna]) {
            expect(isHttpsUrl(value), String(value)).toBe(true);
        }
    });

    it('carries a version without a prerelease label, which extension versions cannot have', () => {
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('does not depend on a newer VS Code API than the engine it declares', () => {
        const engine = /(\d+)\.(\d+)/.exec(manifest.engines.vscode);
        const types = /(\d+)\.(\d+)/.exec(manifest.devDependencies['@types/vscode'] ?? '');

        expect(Number(types?.[2])).toBeLessThanOrEqual(Number(engine?.[2]));
        expect(types?.[1]).toBe(engine?.[1]);
    });

    it('ships the host bundle it names as its entry point', () => {
        expect(manifest.files).toContain(manifest.main.replace(/^\.\//, ''));
        expect(manifest.files).toContain('out/parser.js');
    });

    it('ships the bundles the host starts on demand', () => {
        expect(manifest.files).toEqual(expect.arrayContaining(['out/standalone.js', 'out/metadataWorker.js']));
    });
});

describe('Restricted Mode', () => {
    it('is supported in part, and the manifest says which part', () => {
        expect(manifest.capabilities?.untrustedWorkspaces?.supported).toBe('limited');
        expect(manifest.capabilities?.untrustedWorkspaces?.description).toBeTruthy();
    });

    it('restricts the settings that point at files, and only settings the extension declares', () => {
        const restricted = manifest.capabilities?.untrustedWorkspaces?.restrictedConfigurations ?? [];
        const declared = Object.keys(manifest.contributes.configuration.properties);

        expect(restricted).toEqual(expect.arrayContaining(['trueImportCost.targets', 'trueImportCost.maxMetadataSizeMB']));
        expect(restricted.filter(key => !declared.includes(key))).toEqual([]);
    });
});

describe('what the manifest contributes', () => {
    it('declares exactly the commands the extension registers', () => {
        const declared = manifest.contributes.commands.map(entry => entry.command).sort();

        expect(declared).toEqual(Object.values(Command).sort());
        expect(manifest.contributes.commands.every(entry => entry.title !== '' && entry.category === 'True Import Cost')).toBe(true);
    });

    it('refers in its menus only to declared commands', () => {
        const declared = new Set(manifest.contributes.commands.map(entry => entry.command));
        const used = Object.values(manifest.contributes.menus).flat().map(entry => entry.command);

        expect(used.filter(command => !declared.has(command))).toEqual([]);
    });

    it('declares exactly the views the extension creates, and welcome content only for them', () => {
        const views = Object.values(manifest.contributes.views).flat().map(view => view.id).sort();

        expect(views).toEqual(Object.values(View).sort());
        expect(manifest.contributes.viewsWelcome.every(entry => views.includes(entry.view))).toBe(true);
    });

    it('activates for every language it analyses', () => {
        for (const language of SUPPORTED_LANGUAGES) {
            expect(manifest.activationEvents).toContain(`onLanguage:${language}`);
        }
    });

    it('declares every setting the extension reads, each with a default and a description', () => {
        const properties = manifest.contributes.configuration.properties;

        expect(Object.keys(properties).sort()).toEqual(settingKeysReadByTheExtension().sort());
        for (const [key, property] of Object.entries(properties)) {
            expect(property.default, key).toBeDefined();
            expect(property.markdownDescription, key).toBeTruthy();
        }
    });
});
