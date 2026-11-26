import { formatBytes } from '../../core/format';

import type { ImportCost, ModuleCost } from '../../core/attribution/attribute';
import type { MeasurementPrecision } from '../../core/schema/snapshot';
import type { SourceImport } from '../../parser';
import type { DisplaySettings } from '../services/settings';

export interface LabelContext {
    readonly display: DisplaySettings;
    readonly stale: boolean;
}

const SEPARATOR = ' · ';

export function isEstimate(precision: MeasurementPrecision | undefined): boolean {
    return precision !== undefined && precision !== 'bundler-reported';
}

export function sizeText(bytes: number, precision: MeasurementPrecision | undefined): string {
    return `${isEstimate(precision) ? '~' : ''}${formatBytes(bytes)}`;
}

export function usedOnlyAsType(source: SourceImport): boolean {
    return source.bindings.length > 0
        && source.bindings.every(binding => binding.valueReferences + binding.templateReferences === 0)
        && source.bindings.some(binding => binding.typeReferences > 0);
}

function moduleParts(cost: ModuleCost, display: DisplaySettings): string[] {
    const { impact } = cost;
    const precision = impact.precision;
    const parts: string[] = [];
    if (cost.lazy) {
        parts.push(`${sizeText(impact.bundledBytes, precision)} lazy`);
    } else if (impact.bundledBytes === 0 && impact.lazyBytes > 0) {
        parts.push(`${sizeText(impact.lazyBytes, precision)} lazy`);
    } else {
        parts.push(`${sizeText(impact.bundledBytes, precision)} bundled`);
        if (impact.lazyBytes > 0) {
            parts.push(`+${sizeText(impact.lazyBytes, precision)} lazy`);
        }
    }
    if (display.exclusive && impact.bundledBytes > 0) {
        if (impact.exclusiveBytes === 0) {
            parts.push('shared');
        } else if (impact.exclusiveBytes < impact.bundledBytes) {
            parts.push(`${sizeText(impact.exclusiveBytes, precision)} exclusive`);
        }
    }
    return parts;
}

export function inlineLabel(cost: ImportCost, source: SourceImport, context: LabelContext): string | undefined {
    const { display, stale } = context;
    const changed = stale ? ['source changed'] : [];
    switch (cost.status) {
        case 'bundled':
            return [...moduleParts(cost, display), ...changed].join(SEPARATOR);
        case 'tree-shaken':
            return ['0 B', 'tree-shaken', ...changed].join(SEPARATOR);
        case 'external':
            return display.external ? 'external' : undefined;
        case 'elided':
            if (usedOnlyAsType(source)) {
                return display.typeOnly ? ['0 B', 'used as a type only'].join(SEPARATOR) : undefined;
            }
            return ['0 B', 'unused, removed by the build', ...changed].join(SEPARATOR);
        case 'type-only':
            return display.typeOnly ? ['0 B', 'type-only'].join(SEPARATOR) : undefined;
        case 'unresolved':
            return display.unresolved ? (stale ? 'not in last build' : 'no build record') : undefined;
    }
}
