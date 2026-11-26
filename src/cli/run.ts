import { parseArguments } from './arguments';
import { check, compare, summarize } from './commands';
import { CliError, describeError, ExitCode, UsageError } from './environment';
import { printable } from './output/escape';
import { USAGE } from './usage';

import type { ParsedArguments } from './arguments';
import type { CliEnvironment } from './environment';

const NAME = 'true-import-cost';

function oneLine(message: string): string {
    const lines = message
        .split(/\r?\n/)
        .map(line => line.replace(/(^|\s)[✖→]\s+/g, '$1').trim())
        .filter(line => line !== '');
    return printable(lines.join('; ').replace(/…/g, '...'));
}

function errorLine(error: unknown): string {
    if (error instanceof UsageError) {
        return `${NAME}: ${oneLine(error.message)} (see ${NAME} --help)`;
    }
    if (error instanceof CliError) {
        return `${NAME}: ${oneLine(error.message)}`;
    }
    return `${NAME}: unexpected error: ${oneLine(describeError(error))}`;
}

function dispatch(args: ParsedArguments, environment: CliEnvironment): Promise<number> {
    switch (args.command) {
        case 'help':
            environment.stdout(USAGE);
            return Promise.resolve(ExitCode.ok);
        case 'version':
            environment.stdout(`${environment.version}\n`);
            return Promise.resolve(ExitCode.ok);
        case 'summary':
            return summarize(args, environment);
        case 'compare':
            return compare(args, environment);
        case 'check':
            return check(args, environment);
    }
}

export async function run(argv: readonly string[], environment: CliEnvironment): Promise<number> {
    try {
        return await dispatch(parseArguments(argv), environment);
    } catch (error: unknown) {
        environment.stderr(`${errorLine(error)}\n`);
        return ExitCode.error;
    }
}
