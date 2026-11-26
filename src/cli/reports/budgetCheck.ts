import { describeBuild } from './build';
import { BUDGET_CHECK_FORMAT, REPORT_SCHEMA_VERSION } from './model';
import { evaluateBudgets, packageLimit } from '../../core/budgets';
import { sizeTotals } from '../../core/chunks';

import type { BudgetCheckReport } from './model';
import type { Budget, BudgetResult } from '../../core/budgets';
import type { BuildGraph } from '../../core/graph/buildGraph';

function bundledPackageNames(graph: BuildGraph): Set<string> {
    const names = new Set<string>();
    for (const instance of graph.packages().values()) {
        if (instance.bytes > 0) {
            names.add(instance.name);
        }
    }
    return names;
}

function unbundledPackageBudgets(budget: Budget, graph: BuildGraph): BudgetResult[] {
    const names = [...bundledPackageNames(graph)];
    return [...budget.packages]
        .filter(([pattern, limit]) => !names.some(name => packageLimit({ packages: new Map([[pattern, limit]]) }, name) !== undefined))
        .map(([pattern, limit]): BudgetResult => ({ kind: 'package', label: pattern, limit, actual: 0, exceeded: false }));
}

export function budgetCheckReport(graph: BuildGraph, budget: Budget, target: string): BudgetCheckReport {
    const results = [...evaluateBudgets(budget, sizeTotals(graph.snapshot), graph), ...unbundledPackageBudgets(budget, graph)];
    const exceeded = results.filter(result => result.exceeded).length;
    return {
        format: BUDGET_CHECK_FORMAT,
        schemaVersion: REPORT_SCHEMA_VERSION,
        build: describeBuild(graph),
        target,
        passed: exceeded === 0,
        exceeded,
        results,
    };
}
