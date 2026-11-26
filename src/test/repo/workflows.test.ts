import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOCUMENTS = new Set(['LICENSE', 'README.md', 'CHANGELOG.md']);

const WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/publish.yml', '.github/workflows/publish-packages.yml'];

function requiredFilesOf(workflow: string): string[] {
    const lines = readFileSync(workflow, 'utf8').split('\n');
    const start = lines.findIndex(line => line.trim() === 'required-files: |');
    if (start < 0) {
        return [];
    }
    const indent = /^\s*/.exec(lines[start + 1] ?? '')?.[0].length ?? 0;
    const files: string[] = [];
    for (const line of lines.slice(start + 1)) {
        if (line.trim() === '' || (/^\s*/.exec(line)?.[0].length ?? 0) < indent) {
            break;
        }
        files.push(line.trim());
    }
    return files;
}

describe('the workflows', () => {
    const shipped = (JSON.parse(readFileSync('package.json', 'utf8')) as { readonly files: readonly string[] }).files
        .filter(file => !DOCUMENTS.has(file));

    it.each(['.github/workflows/ci.yml', '.github/workflows/publish.yml'])('%s checks that every file the VSIX ships was built', (workflow) => {
        expect(requiredFilesOf(workflow).sort()).toEqual([...shipped].sort());
    });

    it.each(WORKFLOWS)('%s passes event data to its scripts through the environment, never into the script text', (workflow) => {
        const lines = readFileSync(workflow, 'utf8').split('\n');

        expect(lines.filter(line => /^\s*(- )?run:/.test(line) && line.includes('${{'))).toEqual([]);
    });

    it('attaches the checksums of the published VSIX to the release, after publishing it', () => {
        const publish = readFileSync('.github/workflows/publish.yml', 'utf8');

        expect(publish).toMatch(/\n {2}checksums:\n(?: {4}.*\n)*? {4}needs: publish\n/);
        expect(publish).toContain('sha256sum -- *.vsix | tee SHA256SUMS');
        expect(publish).toContain('gh release upload "$TAG" release/SHA256SUMS');
    });
});
