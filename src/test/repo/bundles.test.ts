import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const EXTENSION = 'out/extension.js';

describe('the bundle VS Code loads on activation', () => {
    it('leaves TypeScript and the Vue compiler to the parser bundle, which it requires on first use', () => {
        expect(existsSync(EXTENSION), `${EXTENSION} is built`).toBe(true);
        expect(statSync(EXTENSION).size).toBeLessThan(1_000_000);
        expect(readFileSync(EXTENSION, 'utf8')).toContain('require("./parser.js")');
    });
});
