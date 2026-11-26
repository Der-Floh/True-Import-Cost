import { describe, expect, it } from 'vitest';

import { parseArguments } from '../../cli/arguments';
import { UsageError } from '../../cli/environment';

function usageError(argv: readonly string[]): string {
    try {
        parseArguments(argv);
    } catch (error: unknown) {
        if (error instanceof UsageError) {
            return error.message;
        }
        throw error;
    }
    throw new Error(`${argv.join(' ')} was accepted`);
}

describe('reading the command line', () => {
    it('reads a summary with its defaults', () => {
        expect(parseArguments(['summary', 'meta.json'])).toEqual({ command: 'summary', metadata: 'meta.json', top: 10, format: 'text', maxSizeMB: 64 });
    });

    it('reads options before and after the files, with a space or an equals sign', () => {
        expect(parseArguments(['--format', 'json', 'compare', 'old.json', '--top=3', 'new.json', '--max-size=1.5'])).toEqual({
            command: 'compare',
            baseline: 'old.json',
            current: 'new.json',
            top: 3,
            format: 'json',
            maxSizeMB: 1.5,
        });
    });

    it('reads a check with its budgets and target', () => {
        expect(parseArguments(['check', 'meta.json', '--budgets', '.vscode/settings.json', '--target', 'webview', '--format', 'markdown'])).toEqual({
            command: 'check',
            metadata: 'meta.json',
            budgets: '.vscode/settings.json',
            target: 'webview',
            format: 'markdown',
            maxSizeMB: 64,
        });
    });

    it('takes everything after -- as a file, even when it looks like an option', () => {
        expect(parseArguments(['summary', '--', '--odd-name.json'])).toMatchObject({ metadata: '--odd-name.json' });
    });

    it.each([
        [['--help']],
        [['-h']],
        [['help']],
        [['summary', 'meta.json', '--help']],
        [['check', '--unknown', '-h']],
    ])('asks for help with %j', (argv) => {
        expect(parseArguments(argv)).toEqual({ command: 'help' });
    });

    it.each([[['--version']], [['-v']], [['summary', '-v']]])('asks for the version with %j', (argv) => {
        expect(parseArguments(argv)).toEqual({ command: 'version' });
    });

    it.each([
        [[], 'no command given'],
        [['build'], 'unknown command "build"; the commands are summary, compare and check'],
        [['summary'], 'summary needs <metadata>'],
        [['compare', 'old.json'], 'compare needs <baseline> and <current>'],
        [['summary', 'a.json', 'b.json'], 'unexpected argument "b.json"'],
        [['check', 'meta.json'], 'check needs --budgets <file>'],
        [['summary', 'meta.json', '--fromat', 'json'], 'unknown option "--fromat"'],
        [['summary', 'meta.json', '-x'], 'unknown option "-x"'],
        [['summary', 'meta.json', '--budgets', 'b.json'], 'summary has no option --budgets'],
        [['check', 'meta.json', '--budgets', 'b.json', '--top', '3'], 'check has no option --top'],
        [['summary', 'meta.json', '--format', 'json', '--format', 'text'], '--format is given more than once'],
        [['summary', 'meta.json', '--format'], '--format needs a value'],
        [['summary', 'meta.json', '--format='], '--format needs a value'],
        [['summary', 'meta.json', '--top', '--format', 'json'], '--top needs a value'],
        [['summary', 'meta.json', '--format', 'html'], '--format must be text, markdown or json, not "html"'],
        [['summary', 'meta.json', '--top', '0'], '--top must be a whole number of 1 or more, not "0"'],
        [['summary', 'meta.json', '--top', '2.5'], '--top must be a whole number of 1 or more, not "2.5"'],
        [['summary', 'meta.json', '--max-size', '0'], '--max-size must be a number of megabytes above 0 and at most 1024, not "0"'],
        [['summary', 'meta.json', '--max-size', '2048'], '--max-size must be a number of megabytes above 0 and at most 1024, not "2048"'],
        [['summary', 'meta.json', '--max-size', '1e3'], '--max-size must be a number of megabytes above 0 and at most 1024, not "1e3"'],
    ])('rejects %j: %s', (argv, message) => {
        expect(usageError(argv)).toBe(message);
    });
});
