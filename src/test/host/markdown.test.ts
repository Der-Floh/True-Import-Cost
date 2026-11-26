import { describe, expect, it } from 'vitest';

import { code, commandLink, escapeMarkdown } from '../../extension/presentation/markdown';

describe('code', () => {
    it('wraps text in a code span', () => {
        expect(code('lodash')).toBe('`lodash`');
    });

    it('replaces the backticks and line breaks that would end the span', () => {
        expect(code(' a`b\r\nc`` ')).toBe('`a b c`');
    });

    it('keeps a span that would otherwise be empty', () => {
        expect(code('``')).toBe('` `');
    });

    it('shortens text longer than 240 characters', () => {
        expect(code('x'.repeat(300))).toBe(`\`${'x'.repeat(240)}…\``);
    });
});

describe('escapeMarkdown', () => {
    it('escapes every character markdown gives a meaning', () => {
        const special = '\\`*_{}[]()#+-.!|<>~&';

        expect(escapeMarkdown(special)).toBe([...special].map(character => `\\${character}`).join(''));
    });

    it('turns line breaks into spaces', () => {
        expect(escapeMarkdown('first\r\n\nsecond')).toBe('first second');
    });

    it('leaves plain words alone', () => {
        expect(escapeMarkdown('Bundled with what it imports')).toBe('Bundled with what it imports');
    });
});

describe('commandLink', () => {
    it('links to a command, passing its argument as an encoded JSON list', () => {
        const link = commandLink('Explain [why]', 'trueImportCost.explainWhyIncluded', { label: 'a b' });

        expect(link).toBe(`[Explain \\[why\\]](command:trueImportCost.explainWhyIncluded?${encodeURIComponent('[{"label":"a b"}]')})`);
    });
});
