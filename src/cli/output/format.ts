import { formatBytes } from '../../core/format';

import type { BuildDescription, SizeChange, TotalKey } from '../reports/model';

export const TOTAL_LABELS: Readonly<Record<TotalKey, string>> = {
    total: 'Total',
    javascript: 'JavaScript',
    css: 'CSS',
    assets: 'Other assets',
    initial: 'Initial load',
    lazy: 'Lazily loaded',
};

export const ESTIMATE_NOTE = '~ marks an estimate rather than a size the bundler reported.';

export function sizeText(bytes: number, estimated = false): string {
    return `${estimated && bytes !== 0 ? '~' : ''}${formatBytes(bytes)}`;
}

export function deltaText(delta: number, estimated = false): string {
    if (delta === 0) {
        return '0 B';
    }
    return `${estimated ? '~' : ''}${delta > 0 ? '+' : '-'}${formatBytes(Math.abs(delta))}`;
}

export function percentText(change: SizeChange): string {
    if (change.before <= 0 || change.delta === 0) {
        return '';
    }
    const percent = Math.abs(change.delta / change.before) * 100;
    const value = percent < 0.1 ? '<0.1' : percent.toFixed(1).replace(/\.0$/, '');
    return `${change.delta > 0 ? '+' : '-'}${value}%`;
}

export function changeText(change: SizeChange): string {
    const percent = percentText(change);
    return percent === '' ? deltaText(change.delta) : `${deltaText(change.delta)} (${percent})`;
}

export function bundlerText(build: BuildDescription): string {
    const { name, version, engine } = build.bundler;
    const main = version === undefined ? name : `${name} ${version}`;
    return engine === undefined ? main : `${main} (${engine})`;
}

export function buildLine(build: BuildDescription, wrap: (text: string) => string): string {
    const bundler = wrap(bundlerText(build));
    return build.mode === undefined ? bundler : `${bundler}, ${build.mode} build`;
}
