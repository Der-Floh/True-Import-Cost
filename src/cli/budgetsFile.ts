import path from 'node:path';

import { CliError } from './environment';
import { parseJson, readTextFile } from './files';
import { parseJsonc } from './jsonc';
import { isRecord } from '../core/adapters/adapter';
import { parseBudgets, parseSize } from '../core/budgets';

import type { CliEnvironment } from './environment';
import type { Budget } from '../core/budgets';

const BUDGETS_SETTING = 'trueImportCost.budgets';

const FIELDS: readonly string[] = ['total', 'initial', 'javascript', 'css', 'import', 'packages'];

function budgetsIn(document: unknown, file: string): unknown {
    if (isRecord(document) && Object.hasOwn(document, BUDGETS_SETTING)) {
        return document[BUDGETS_SETTING];
    }
    if (path.basename(file).toLowerCase() === 'settings.json') {
        throw new CliError(`${file}: there is no "${BUDGETS_SETTING}" setting in it`);
    }
    return document;
}

function sizeProblem(where: string, value: unknown): string | undefined {
    return parseSize(value) === undefined ? `${where} is not a size such as 30000, "30 kB" or "1.5 MB": ${JSON.stringify(value)}` : undefined;
}

function packagesProblem(target: string, packages: unknown): string | undefined {
    if (!isRecord(packages)) {
        return `"${target}".packages is not an object of package names and sizes`;
    }
    for (const [name, limit] of Object.entries(packages)) {
        const problem = name.trim() === '' ? `"${target}".packages has an empty package name` : sizeProblem(`"${target}".packages["${name}"]`, limit);
        if (problem !== undefined) {
            return problem;
        }
    }
    return undefined;
}

function budgetProblem(target: string, budget: unknown): string | undefined {
    if (target.trim() === '') {
        return 'a budget has an empty target name';
    }
    if (!isRecord(budget)) {
        return `the budget of "${target}" is not an object`;
    }
    for (const [field, value] of Object.entries(budget)) {
        if (!FIELDS.includes(field)) {
            return `the budget of "${target}" has an unknown field "${field}"; the fields are ${FIELDS.join(', ')}`;
        }
        const problem = field === 'packages' ? packagesProblem(target, value) : sizeProblem(`"${target}".${field}`, value);
        if (problem !== undefined) {
            return problem;
        }
    }
    return undefined;
}

function findBudgetProblem(value: unknown): string | undefined {
    if (!isRecord(value)) {
        return 'the budgets are not an object keyed by build target';
    }
    for (const [target, budget] of Object.entries(value)) {
        const problem = budgetProblem(target, budget);
        if (problem !== undefined) {
            return problem;
        }
    }
    return undefined;
}

export async function readBudgets(environment: CliEnvironment, file: string, maxSizeMB: number): Promise<ReadonlyMap<string, Budget>> {
    const { text } = await readTextFile(environment, file, maxSizeMB);
    const budgets = budgetsIn(parseJson(file, text, parseJsonc), file);
    const problem = findBudgetProblem(budgets);
    if (problem !== undefined) {
        throw new CliError(`${file}: ${problem}`);
    }
    return parseBudgets(budgets);
}

export function hasCheckableLimit(budget: Budget): boolean {
    return [budget.total, budget.initial, budget.javascript, budget.css].some(limit => limit !== undefined) || budget.packages.size > 0;
}
