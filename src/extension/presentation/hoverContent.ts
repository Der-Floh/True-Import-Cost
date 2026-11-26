import * as vscode from 'vscode';

import { inlineLabel, sizeText } from './labels';
import { code, commandLink, escapeMarkdown } from './markdown';
import { MEASUREMENT_COMMANDS, measurementActions, measurementLines } from './measurementContent';
import { displayModulePath } from './modulePaths';
import { Command } from '../constants';
import { formatAge, formatBytes } from '../../core/format';

import type { ImportCost, ModuleCost } from '../../core/attribution/attribute';
import type { MatchConfidence } from '../../core/attribution/match';
import type { MeasurementPrecision } from '../../core/schema/snapshot';
import type { MeasurementHover } from './measurementContent';
import type { BindingUsage } from '../../parser';
import type { DocumentCosts, ImportCostEntry } from '../services/importCosts';
import type { LoadedTarget } from '../services/metadataLoader';
import type { DisplaySettings } from '../services/settings';

export interface OtherTargetCost {
    readonly target: LoadedTarget;
    readonly cost: ImportCost | undefined;
}

export interface HoverInput {
    readonly entry: ImportCostEntry;
    readonly costs: DocumentCosts;
    readonly others: readonly OtherTargetCost[];
    readonly display: DisplaySettings;
    readonly now: number;
    readonly measurement?: MeasurementHover;
}

export interface ExplainArguments {
    readonly target: string;
    readonly modules?: readonly string[];
    readonly packageRoot?: string;
    readonly packageName?: string;
    readonly label?: string;
}

const PRECISION_TEXT: Readonly<Record<MeasurementPrecision, string>> = {
    'bundler-reported': 'reported by the bundler',
    'sourcemap-estimate': 'estimated from the production source maps',
    'rendered-length': 'rendered module lengths, before minification',
    'proportional-estimate': 'estimated by scaling rendered module lengths to the minified output',
};

const CONFIDENCE_TEXT: Readonly<Record<MatchConfidence, string>> = {
    exact: 'the import as the bundler resolved it',
    resolved: 'its resolved path in the build',
    heuristic: 'a path heuristic, as for an alias; it may be wrong',
};

const MAX_DEFINERS_SHOWN = 3;

const STATUS_TEXT: Readonly<Record<Exclude<ImportCost['status'], 'bundled'>, string>> = {
    'tree-shaken': 'The build resolved this import but kept none of its code.',
    external: 'The build leaves this import external: it is loaded at runtime, not bundled.',
    elided: 'The build dropped this import: nothing uses it as a value, so compilation removed it.',
    'type-only': 'Type-only imports are erased during compilation and never reach the build.',
    unresolved: 'The build metadata has no record of this import.',
};

function bundlerText(target: LoadedTarget): string {
    const { bundler, mode } = target.snapshot;
    const name = [bundler.name, bundler.version].filter(Boolean).join(' ');
    const engine = bundler.engine === undefined ? '' : ` (${bundler.engine})`;
    const modeText = mode === undefined ? '' : ` · ${mode}`;
    return `${escapeMarkdown(name + engine)}${escapeMarkdown(modeText)}`;
}

function title(entry: ImportCostEntry): string {
    const { cost, source } = entry;
    if ((cost.status === 'bundled' || cost.status === 'tree-shaken') && cost.package) {
        const version = cost.package.version === undefined ? '' : ` ${escapeMarkdown(cost.package.version)}`;
        return `**${code(cost.package.name)}**${version}`;
    }
    if (cost.status === 'bundled' || cost.status === 'tree-shaken') {
        return `**${code(cost.module.path)}**`;
    }
    return `**${code(source.specifier)}**`;
}

function costTable(cost: ModuleCost): string[] {
    const { impact } = cost;
    const precision = impact.precision;
    const rows: [string, string][] = [];
    rows.push([cost.lazy ? 'Loaded lazily, with what it imports' : 'Bundled, with what it imports', sizeText(impact.bundledBytes, precision)]);
    if (impact.bundledBytes > 0) {
        rows.push(['Exclusive to this import', sizeText(impact.exclusiveBytes, precision)]);
        rows.push(['Shared with other imports', sizeText(impact.sharedBytes, precision)]);
    }
    if (impact.lazyBytes > 0) {
        rows.push(['Behind its dynamic imports', sizeText(impact.lazyBytes, precision)]);
    }
    if (cost.package) {
        rows.push(['Whole package in this build', sizeText(cost.package.bytes, precision)]);
    }
    rows.push(['Modules retained', `${impact.retainedModuleCount} of ${impact.moduleCount}`]);
    return ['| | |', '|:--|--:|', ...rows.map(([label, value]) => `| ${escapeMarkdown(label)} | ${escapeMarkdown(value)} |`)];
}

function pullsIn(cost: ModuleCost): string | undefined {
    const others = cost.impact.packages
        .filter(share => share.name !== undefined && share.key !== cost.package?.key)
        .slice(0, 5)
        .map(share => `${code(share.name as string)} ${escapeMarkdown(sizeText(share.bytes, cost.impact.precision))}`);
    return others.length === 0 ? undefined : `Pulls in ${others.join(', ')}`;
}

function barrelText(target: LoadedTarget, cost: ModuleCost): string | undefined {
    const trace = cost.barrel;
    if (!trace) {
        return undefined;
    }
    const name = (id: string): string => {
        const module = target.graph.module(id);
        return code(module === undefined ? id : displayModulePath(module));
    };
    const shown = trace.definers.slice(0, MAX_DEFINERS_SHOWN).map(name).join(', ');
    const more = trace.definers.length - MAX_DEFINERS_SHOWN;
    return `Traced through the barrel ${name(trace.moduleId)} to ${shown}${more > 0 ? ` and ${more} more` : ''}`;
}

function duplicateText(cost: ModuleCost): string | undefined {
    const duplicate = cost.duplicate;
    if (!duplicate) {
        return undefined;
    }
    const instances = duplicate.instances
        .map(instance => `${escapeMarkdown(instance.version ?? 'unknown version')} (${escapeMarkdown(formatBytes(instance.bytes))}, ${code(instance.root)})`)
        .join(', ');
    return `$(warning) ${code(duplicate.name)} is bundled ${duplicate.instances.length} times: ${instances}`;
}

function bindingText(binding: BindingUsage): string | undefined {
    if (binding.typeOnly) {
        return undefined;
    }
    const facts: string[] = [];
    for (const member of binding.members.slice(0, 8)) {
        facts.push(code(member.kind === 'call' || member.kind === 'construct' ? `${member.name}()` : member.name));
    }
    if (binding.members.length > 8) {
        facts.push(`and ${binding.members.length - 8} more`);
    }
    if (binding.calls > 0) {
        facts.push(`called ${binding.calls === 1 ? 'once' : `${binding.calls} times`}`);
    }
    if (binding.templateReferences > 0) {
        facts.push('used in the template');
    }
    if (binding.dynamicAccess) {
        facts.push('accessed with computed keys');
    }
    if (binding.escapes) {
        facts.push('passed on as a value, so the bundler may have to keep all of it');
    }
    if (facts.length === 0) {
        facts.push(binding.valueReferences + binding.typeReferences === 0 ? 'unused' : binding.valueReferences === 0 ? 'used as a type only' : 'referenced');
    }
    const name = binding.imported === binding.local || binding.imported === '*' || binding.imported === 'default'
        ? binding.local
        : `${binding.imported} as ${binding.local}`;
    return `${code(name)}: ${facts.join(', ')}`;
}

function explainArguments(target: LoadedTarget, cost: ModuleCost): ExplainArguments {
    return cost.package
        ? { target: target.key, packageRoot: cost.package.root, label: cost.package.name }
        : { target: target.key, modules: [cost.module.id], label: cost.module.path };
}

export function hoverMarkdown(input: HoverInput): vscode.MarkdownString {
    const { entry, costs, others, display, now, measurement = {} } = input;
    const { cost, source } = entry;
    const target = costs.target;
    const lines: string[] = [];

    lines.push(title(entry));
    lines.push(`${code(target.id)} · ${bundlerText(target)}`);
    lines.push('');
    lines.push(...measurementLines(measurement, now).flatMap(line => [line, '']));

    if (cost.status === 'bundled') {
        lines.push(...costTable(cost));
        lines.push('');
        for (const extra of [barrelText(target, cost), pullsIn(cost), duplicateText(cost)]) {
            if (extra !== undefined) {
                lines.push(extra, '');
            }
        }
    } else {
        lines.push(cost.status === 'unresolved' && costs.stale
            ? 'This import is newer than the last build, or the build no longer contains it.'
            : STATUS_TEXT[cost.status]);
        lines.push('');
        if (cost.status === 'tree-shaken') {
            const duplicate = duplicateText(cost);
            if (duplicate !== undefined) {
                lines.push(duplicate, '');
            }
        }
    }

    if (costs.analysis.usageAnalysed) {
        const usage = source.bindings.map(bindingText).filter((text): text is string => text !== undefined);
        if (usage.length > 0) {
            lines.push(`**Usage** · ${usage.join(' · ')}`, '');
        }
    }

    const facts: string[] = [];
    if (cost.status === 'bundled' || cost.status === 'tree-shaken') {
        const precision = cost.impact.precision;
        if (precision !== undefined) {
            facts.push(`Sizes: ${escapeMarkdown(PRECISION_TEXT[precision])}`);
        }
        facts.push(`Matched by ${escapeMarkdown(CONFIDENCE_TEXT[cost.match.confidence])}`);
        facts.push('_Attribution is per module: a module several imports reach counts toward each of them, and exclusive bytes assume the rest of the build stays as it is._');
    }
    facts.push(`Built ${escapeMarkdown(formatAge(now - target.snapshot.createdAt))}${costs.stale ? ' · $(history) source changed since' : ''}`);
    lines.push(facts.join('  \n'), '');

    const otherLines = others.map(({ target: other, cost: otherCost }) => {
        const label = otherCost === undefined ? 'not in this target' : inlineLabel(otherCost, source, { display, stale: false }) ?? otherCost.status;
        return `${code(other.id)} ${escapeMarkdown(label)}`;
    });
    if (otherLines.length > 0) {
        lines.push(`Other targets: ${otherLines.join(' · ')}`, '');
    }

    const links = [
        ...(cost.status === 'bundled' || cost.status === 'tree-shaken' ? [commandLink('Explain why included', Command.explainWhyIncluded, explainArguments(target, cost))] : []),
        ...measurementActions(measurement),
    ];
    if (links.length > 0) {
        lines.push(links.join(' · '));
    }

    const markdown = new vscode.MarkdownString(lines.join('\n'), true);
    markdown.isTrusted = { enabledCommands: [Command.explainWhyIncluded, ...MEASUREMENT_COMMANDS] };
    return markdown;
}

export function explainArgumentsFor(target: LoadedTarget, cost: ImportCost): ExplainArguments | undefined {
    return cost.status === 'bundled' || cost.status === 'tree-shaken' ? explainArguments(target, cost) : undefined;
}
