import { UsageError } from './environment';

export type OutputFormat = 'text' | 'markdown' | 'json';

export type CommandName = 'summary' | 'compare' | 'check';

export type OptionName = 'format' | 'top' | 'budgets' | 'target' | 'max-size';

interface CommonArguments {
    readonly format: OutputFormat;
    readonly maxSizeMB: number;
}

export interface SummaryArguments extends CommonArguments {
    readonly command: 'summary';
    readonly metadata: string;
    readonly top: number;
}

export interface CompareArguments extends CommonArguments {
    readonly command: 'compare';
    readonly baseline: string;
    readonly current: string;
    readonly top: number;
}

export interface CheckArguments extends CommonArguments {
    readonly command: 'check';
    readonly metadata: string;
    readonly budgets: string;
    readonly target?: string;
}

export type ParsedArguments =
    | { readonly command: 'help' }
    | { readonly command: 'version' }
    | SummaryArguments
    | CompareArguments
    | CheckArguments;

interface CommandSpec {
    readonly operands: readonly string[];
    readonly options: readonly OptionName[];
}

export const COMMANDS: Readonly<Record<CommandName, CommandSpec>> = {
    summary: { operands: ['metadata'], options: ['format', 'top', 'max-size'] },
    compare: { operands: ['baseline', 'current'], options: ['format', 'top', 'max-size'] },
    check: { operands: ['metadata'], options: ['budgets', 'target', 'format', 'max-size'] },
};

export const OPTIONS: readonly OptionName[] = ['format', 'top', 'budgets', 'target', 'max-size'];

export const OUTPUT_FORMATS: readonly OutputFormat[] = ['text', 'markdown', 'json'];

const DEFAULT_TOP = 10;

const DEFAULT_MAX_SIZE_MB = 64;

const MAX_SIZE_LIMIT_MB = 1024;

const HELP_FLAGS = new Set(['--help', '-h']);

const VERSION_FLAGS = new Set(['--version', '-v']);

interface Tokens {
    readonly operands: readonly string[];
    readonly options: ReadonlyMap<OptionName, string>;
}

function listed(items: readonly string[], last: string): string {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1] ?? ''}`;
}

function isCommandName(value: string): value is CommandName {
    return Object.hasOwn(COMMANDS, value);
}

function isOptionName(value: string): value is OptionName {
    return (OPTIONS as readonly string[]).includes(value);
}

function flagsOf(argv: readonly string[]): readonly string[] {
    const end = argv.indexOf('--');
    return end < 0 ? argv : argv.slice(0, end);
}

function separateValue(next: string | undefined): string | undefined {
    return next === undefined || next.startsWith('-') ? undefined : next;
}

function readOption(argv: readonly string[], index: number, options: Map<OptionName, string>): number {
    const argument = argv[index] ?? '';
    const equals = argument.indexOf('=');
    const name = argument.slice(2, equals < 0 ? undefined : equals);
    if (!argument.startsWith('--') || !isOptionName(name)) {
        throw new UsageError(`unknown option "${argument}"`);
    }
    if (options.has(name)) {
        throw new UsageError(`--${name} is given more than once`);
    }
    const value = equals >= 0 ? argument.slice(equals + 1) : separateValue(argv[index + 1]);
    if (value === undefined || value === '') {
        throw new UsageError(`--${name} needs a value`);
    }
    options.set(name, value);
    return equals >= 0 ? index + 1 : index + 2;
}

function tokenize(argv: readonly string[]): Tokens {
    const operands: string[] = [];
    const options = new Map<OptionName, string>();
    let index = 0;
    while (index < argv.length) {
        const argument = argv[index] ?? '';
        if (argument === '--') {
            operands.push(...argv.slice(index + 1));
            break;
        }
        if (argument.startsWith('-') && argument !== '-') {
            index = readOption(argv, index, options);
        } else {
            operands.push(argument);
            index++;
        }
    }
    return { operands, options };
}

function checkOptions(command: CommandName, options: ReadonlyMap<OptionName, string>): void {
    for (const name of options.keys()) {
        if (!COMMANDS[command].options.includes(name)) {
            throw new UsageError(`${command} has no option --${name}`);
        }
    }
}

function checkOperands(command: CommandName, operands: readonly string[]): void {
    const expected = COMMANDS[command].operands;
    if (operands.length < expected.length) {
        throw new UsageError(`${command} needs ${expected.map(name => `<${name}>`).join(' and ')}`);
    }
    const extra = operands[expected.length];
    if (extra !== undefined) {
        throw new UsageError(`unexpected argument "${extra}"`);
    }
}

function readFormat(value: string | undefined): OutputFormat {
    if (value === undefined) {
        return 'text';
    }
    const format = OUTPUT_FORMATS.find(candidate => candidate === value);
    if (format === undefined) {
        throw new UsageError(`--format must be ${listed(OUTPUT_FORMATS, 'or')}, not "${value}"`);
    }
    return format;
}

function readTop(value: string | undefined): number {
    if (value === undefined) {
        return DEFAULT_TOP;
    }
    const top = /^\d+$/.test(value) ? Number(value) : Number.NaN;
    if (!Number.isSafeInteger(top) || top < 1) {
        throw new UsageError(`--top must be a whole number of 1 or more, not "${value}"`);
    }
    return top;
}

function readMaxSize(value: string | undefined): number {
    if (value === undefined) {
        return DEFAULT_MAX_SIZE_MB;
    }
    const megabytes = /^\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
    if (!(megabytes > 0 && megabytes <= MAX_SIZE_LIMIT_MB)) {
        throw new UsageError(`--max-size must be a number of megabytes above 0 and at most ${MAX_SIZE_LIMIT_MB}, not "${value}"`);
    }
    return megabytes;
}

function commandArguments(command: CommandName, operands: readonly string[], options: ReadonlyMap<OptionName, string>): ParsedArguments {
    checkOptions(command, options);
    checkOperands(command, operands);
    const common = { format: readFormat(options.get('format')), maxSizeMB: readMaxSize(options.get('max-size')) };
    const [first = '', second = ''] = operands;
    if (command === 'summary') {
        return { command, metadata: first, top: readTop(options.get('top')), ...common };
    }
    if (command === 'compare') {
        return { command, baseline: first, current: second, top: readTop(options.get('top')), ...common };
    }
    const budgets = options.get('budgets');
    if (budgets === undefined) {
        throw new UsageError('check needs --budgets <file>');
    }
    const target = options.get('target');
    return { command, metadata: first, budgets, ...(target === undefined ? {} : { target }), ...common };
}

export function parseArguments(argv: readonly string[]): ParsedArguments {
    const flags = flagsOf(argv);
    if (argv[0] === 'help' || flags.some(flag => HELP_FLAGS.has(flag))) {
        return { command: 'help' };
    }
    if (flags.some(flag => VERSION_FLAGS.has(flag))) {
        return { command: 'version' };
    }
    const { operands, options } = tokenize(argv);
    const [command, ...rest] = operands;
    if (command === undefined) {
        throw new UsageError('no command given');
    }
    if (!isCommandName(command)) {
        throw new UsageError(`unknown command "${command}"; the commands are ${listed(Object.keys(COMMANDS), 'and')}`);
    }
    return commandArguments(command, rest, options);
}
