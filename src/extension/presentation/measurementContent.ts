import { code, commandLink, escapeMarkdown } from './markdown';
import { Command } from '../constants';
import { formatAge, formatBytes } from '../../core/format';
import { savingsOf } from '../../core/measurement';

import type { ImportMeasurement } from '../../core/measurement';
import type { StandaloneSize } from '../../core/standaloneProtocol';
import type { MeasureArguments } from '../measure/importMeasurer';
import type { StandaloneArguments, StandaloneMeasurement } from '../measure/standaloneSizes';

export interface MeasurementHover {
    readonly measurement?: ImportMeasurement;
    readonly measure?: MeasureArguments;
    readonly standalone?: StandaloneMeasurement;
    readonly measureStandalone?: StandaloneArguments;
}

export const MEASUREMENT_COMMANDS: readonly string[] = [Command.measureImport, Command.measureStandalone];

function bytes(value: number): string {
    return escapeMarkdown(formatBytes(value));
}

function savingText(measurement: ImportMeasurement): string {
    const saved = savingsOf(measurement);
    if (saved.total === 0) {
        return 'the build is the same size';
    }
    if (saved.total < 0) {
        return `the build is **${bytes(-saved.total)}** larger`;
    }
    if (saved.initial >= saved.total) {
        return `the build is **${bytes(saved.total)}** smaller, all of it in the initial load`;
    }
    return saved.initial > 0
        ? `the build is **${bytes(saved.total)}** smaller, ${bytes(saved.initial)} of it in the initial load`
        : `the build is **${bytes(saved.total)}** smaller, none of it in the initial load`;
}

function measuredLine(measurement: ImportMeasurement, now: number): string {
    const how = measurement.method === 'built-without' ? 'Built without this import' : 'In the build without this import';
    return `**Measured** · ${how}, ${savingText(measurement)} · ${escapeMarkdown(formatAge(now - measurement.measuredAt))}`;
}

function sizeText(size: StandaloneSize): string {
    return `${bytes(size.bytes)} (${bytes(size.gzipBytes)} gzipped)`;
}

function standaloneLine(standalone: StandaloneMeasurement): string {
    const platform = standalone.platform === 'node' ? 'Node.js' : 'browsers';
    const imported = standalone.imported === undefined || standalone.names === 'all'
        ? ''
        : `${code(`{ ${[...new Set(standalone.names)].join(', ')} }`)} ${sizeText(standalone.imported)}, `;
    return `**Standalone** · ${imported}the whole package ${sizeText(standalone.whole)}, bundled by itself with ${escapeMarkdown(standalone.bundler)} for ${platform}`;
}

export function measurementLines(input: MeasurementHover, now: number): string[] {
    return [
        ...(input.measurement === undefined ? [] : [measuredLine(input.measurement, now)]),
        ...(input.standalone === undefined ? [] : [standaloneLine(input.standalone)]),
    ];
}

export function measurementActions(input: MeasurementHover): string[] {
    return [
        ...(input.measure === undefined ? [] : [commandLink(input.measurement === undefined ? 'Measure by building without it' : 'Measure again', Command.measureImport, input.measure)]),
        ...(input.measureStandalone === undefined ? [] : [commandLink(input.standalone === undefined ? 'Measure standalone size' : 'Measure standalone size again', Command.measureStandalone, input.measureStandalone)]),
    ];
}
