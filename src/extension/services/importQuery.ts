import type { ImportQuery } from '../../core/attribution/attribute';
import type { SourceImport } from '../../parser';

function valueNames(source: SourceImport, usageAnalysed: boolean): string[] | undefined {
    if (source.kind !== 'named' && source.kind !== 'default') {
        return undefined;
    }
    const names = source.bindings
        .filter(binding => !binding.typeOnly && (!usageAnalysed || binding.valueReferences + binding.templateReferences > 0))
        .map(binding => binding.imported);
    return names.length === 0 ? undefined : [...new Set(names)];
}

export function toQuery(source: SourceImport, usageAnalysed = false): ImportQuery {
    const kind = source.kind === 'dynamic'
        ? 'dynamic'
        : source.kind === 'require' || source.kind === 'import-equals'
            ? 'require'
            : source.kind === 're-export' || source.kind === 'export-all' ? 're-export' : 'static';
    const names = valueNames(source, usageAnalysed);
    return {
        specifier: source.specifier,
        kind,
        typeOnly: source.typeOnly,
        sideEffectOnly: source.kind === 'side-effect',
        ...(source.hasValueUsage === undefined ? {} : { hasValueUsage: source.hasValueUsage }),
        ...(names === undefined ? {} : { names }),
    };
}
