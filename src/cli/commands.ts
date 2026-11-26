import { hasCheckableLimit, readBudgets } from './budgetsFile';
import { CliError, ExitCode } from './environment';
import { loadBuild } from './metadata';
import { budgetCheckMarkdown, budgetCheckText } from './output/budgetCheckOutput';
import { comparisonMarkdown, comparisonText } from './output/comparisonOutput';
import { jsonText } from './output/escape';
import { summaryMarkdown, summaryText } from './output/summaryOutput';
import { budgetCheckReport } from './reports/budgetCheck';
import { comparisonReport } from './reports/comparison';
import { summaryReport } from './reports/summary';
import { budgetFor } from '../core/budgets';

import type { CheckArguments, CompareArguments, OutputFormat, SummaryArguments } from './arguments';
import type { CliEnvironment } from './environment';

function rendered<T>(report: T, format: OutputFormat, text: (report: T) => string, markdown: (report: T) => string): string {
    switch (format) {
        case 'json':
            return jsonText(report);
        case 'markdown':
            return markdown(report);
        default:
            return text(report);
    }
}

export async function summarize(args: SummaryArguments, environment: CliEnvironment): Promise<number> {
    const build = await loadBuild(environment, args.metadata, args.maxSizeMB);
    environment.stdout(rendered(summaryReport(build.graph, args.top), args.format, summaryText, summaryMarkdown));
    return ExitCode.ok;
}

export async function compare(args: CompareArguments, environment: CliEnvironment): Promise<number> {
    const baseline = await loadBuild(environment, args.baseline, args.maxSizeMB);
    const current = await loadBuild(environment, args.current, args.maxSizeMB);
    environment.stdout(rendered(comparisonReport(baseline.graph, current.graph, args.top), args.format, comparisonText, comparisonMarkdown));
    return ExitCode.ok;
}

export async function check(args: CheckArguments, environment: CliEnvironment): Promise<number> {
    const budgets = await readBudgets(environment, args.budgets, args.maxSizeMB);
    const build = await loadBuild(environment, args.metadata, args.maxSizeMB);
    const target = args.target ?? build.graph.snapshot.target;
    const budget = budgetFor(budgets, target);
    if (budget === undefined) {
        const hint = args.target === undefined ? '; name the target whose budgets apply with --target' : '';
        throw new CliError(`${args.budgets} has no budget for "${target}" and none for "*"${hint}`);
    }
    if (!hasCheckableLimit(budget)) {
        throw new CliError(`the budget of "${target}" in ${args.budgets} sets no total, initial, javascript, css or packages limit; an import limit is checked in the editor, per import`);
    }
    const report = budgetCheckReport(build.graph, budget, target);
    environment.stdout(rendered(report, args.format, budgetCheckText, budgetCheckMarkdown));
    return report.passed ? ExitCode.ok : ExitCode.budgetExceeded;
}
