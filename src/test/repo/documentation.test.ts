import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { COMMANDS, OPTIONS, OUTPUT_FORMATS } from '../../cli/arguments';

interface Manifest {
    readonly version: string;
    readonly contributes: {
        readonly commands: readonly { readonly title: string }[];
        readonly configuration: { readonly properties: Readonly<Record<string, unknown>> };
    };
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;
const readme = readFileSync('README.md', 'utf8');

describe('the README', () => {
    it('documents every setting', () => {
        const missing = Object.keys(manifest.contributes.configuration.properties).filter(key => !readme.includes(`\`${key}\``));

        expect(missing).toEqual([]);
    });

    it('documents every command', () => {
        const missing = manifest.contributes.commands.map(command => command.title).filter(title => !readme.includes(title));

        expect(missing).toEqual([]);
    });

    it('links the security policy and the bundler plugins', () => {
        expect(readme).toContain('SECURITY.md');
        expect(readme).toContain('@true-import-cost/vite');
        expect(readme).toContain('@true-import-cost/esbuild');
        expect(readme).toContain('@true-import-cost/webpack');
        expect(readme).toContain('@true-import-cost/cli');
        expect(readme).toContain('@true-import-cost/snapshot');
    });
});

describe('the changelog', () => {
    it('has an entry for the current version', () => {
        expect(readFileSync('CHANGELOG.md', 'utf8')).toContain(`## ${manifest.version}`);
    });
});

describe('the plugin packages', () => {
    it.each(['packages/esbuild', 'packages/vite', 'packages/webpack'])('%s documents every option it accepts', (directory) => {
        const source = readFileSync(directory.replace('packages/', 'src/plugins/').concat('.ts'), 'utf8');
        const options = [...(/export interface TrueImportCostOptions \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '').matchAll(/readonly (\w+)\?/g)].map(match => match[1]);
        const packageReadme = readFileSync(`${directory}/README.md`, 'utf8');

        expect(options.length).toBeGreaterThan(0);
        expect(options.filter(option => !packageReadme.includes(`\`${option}\``))).toEqual([]);
    });
});

describe('the snapshot package', () => {
    it('documents every export', () => {
        const source = readFileSync('src/plugins/snapshot.ts', 'utf8');
        const exported = [...source.matchAll(/^export (?:type )?\{([^}]*)\}/gm)].flatMap(match => (match[1] ?? '').split(',').map(name => name.trim()).filter(name => name !== ''));
        const packageReadme = readFileSync('packages/snapshot/README.md', 'utf8');

        expect(exported.length).toBeGreaterThan(30);
        expect(exported.filter(name => !new RegExp(`\`${name}[\`(]`).test(packageReadme))).toEqual([]);
    });
});

describe('the guide to writing a plugin', () => {
    it('is linked from the snapshot format and from the architecture', () => {
        expect(existsSync('docs/writing-a-plugin.md')).toBe(true);
        expect(readFileSync('docs/snapshot-schema.md', 'utf8')).toContain('(writing-a-plugin.md)');
        expect(readFileSync('docs/architecture.md', 'utf8')).toContain('(writing-a-plugin.md)');
    });
});

describe('the CLI package', () => {
    it('documents every command, option and output format the CLI accepts', () => {
        const cliReadme = readFileSync('packages/cli/README.md', 'utf8');
        const commands = Object.keys(COMMANDS).filter(command => !cliReadme.includes(`true-import-cost ${command}`));
        const options = OPTIONS.filter(option => !cliReadme.includes(`\`--${option}\``));
        const formats = OUTPUT_FORMATS.filter(format => !cliReadme.includes(`\`${format}\``));

        expect([...commands, ...options, ...formats]).toEqual([]);
    });
});

describe('the repository', () => {
    it('has a security policy', () => {
        expect(existsSync('SECURITY.md')).toBe(true);
    });
});
