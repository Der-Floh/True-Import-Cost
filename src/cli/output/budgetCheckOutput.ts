import { code, printable } from './escape';
import { buildLine, ESTIMATE_NOTE, sizeText } from './format';
import { markdownTable, textTable } from './table';
import { formatBytes } from '../../core/format';

import type { Column, Row } from './table';
import type { BudgetCheckReport } from '../reports/model';
import type { BudgetResult } from '../../core/budgets';

type Wrap = (text: string) => string;

function isEstimate(report: BudgetCheckReport, result: BudgetResult): boolean {
    return report.build.estimated && result.kind === 'package';
}

function isUnbundled(result: BudgetResult): boolean {
    return result.kind === 'package' && result.actual === 0;
}

function margin(result: BudgetResult, estimated: boolean): string {
    if (isUnbundled(result)) {
        return 'not bundled';
    }
    const difference = sizeText(Math.abs(result.actual - result.limit), estimated);
    return result.exceeded ? `${difference} over` : `${difference} left`;
}

function budgetLabel(result: BudgetResult, wrap: Wrap): string {
    return result.kind === 'package' ? `Package ${wrap(result.label)}` : result.label;
}

function verdict(report: BudgetCheckReport): string {
    const count = report.results.length;
    if (report.exceeded > 0) {
        return `${report.exceeded} of ${count} ${count === 1 ? 'budget' : 'budgets'} exceeded`;
    }
    return count === 1 ? 'the budget is met' : `all ${count} budgets met`;
}

function capitalized(text: string): string {
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function hasEstimates(report: BudgetCheckReport): boolean {
    return report.results.some(result => isEstimate(report, result) && !isUnbundled(result));
}

export function budgetCheckText(report: BudgetCheckReport): string {
    const columns: Column[] = [
        { title: 'Status', align: 'left' },
        { title: 'Size', align: 'right' },
        { title: 'Limit', align: 'right' },
        { title: 'Margin', align: 'right' },
        { title: 'Budget', align: 'left' },
    ];
    const rows = report.results.map((result): Row => {
        const estimated = isEstimate(report, result);
        return [result.exceeded ? 'exceeded' : 'ok', sizeText(result.actual, estimated), formatBytes(result.limit), margin(result, estimated), budgetLabel(result, printable)];
    });
    const lines = [
        `Size budgets of ${printable(report.target)}: ${buildLine(report.build, printable)}`,
        '',
        ...textTable(columns, rows),
        '',
        `${capitalized(verdict(report))}.`,
        ...(hasEstimates(report) ? ['', ESTIMATE_NOTE] : []),
    ];
    return `${lines.join('\n')}\n`;
}

function statusMarkdown(result: BudgetResult, estimated: boolean): string {
    if (isUnbundled(result)) {
        return 'Not bundled';
    }
    const difference = sizeText(Math.abs(result.actual - result.limit), estimated);
    return result.exceeded ? `**Exceeded** by ${difference}` : `${difference} left`;
}

export function budgetCheckMarkdown(report: BudgetCheckReport): string {
    const columns: Column[] = [
        { title: 'Budget', align: 'left' },
        { title: 'Size', align: 'right' },
        { title: 'Limit', align: 'right' },
        { title: 'Status', align: 'left' },
    ];
    const rows = report.results.map((result): Row => {
        const estimated = isEstimate(report, result);
        return [budgetLabel(result, code), sizeText(result.actual, estimated), formatBytes(result.limit), statusMarkdown(result, estimated)];
    });
    const lines = [
        `### Size budgets of ${code(report.target)}: ${verdict(report)}`,
        '',
        `Built by ${buildLine(report.build, code)}.`,
        '',
        ...markdownTable(columns, rows),
        ...(hasEstimates(report) ? ['', ESTIMATE_NOTE] : []),
    ];
    return `${lines.join('\n')}\n`;
}
