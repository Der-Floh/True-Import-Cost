import type { ImportQuery } from '../../core/attribution/attribute';
import type { SourceImport } from '../../parser';

export function toQuery(source: SourceImport): ImportQuery {
    const kind = source.kind === 'dynamic'
        ? 'dynamic'
        : source.kind === 'require' || source.kind === 'import-equals'
            ? 'require'
            : source.kind === 're-export' || source.kind === 'export-all' ? 're-export' : 'static';
    return {
        specifier: source.specifier,
        kind,
        typeOnly: source.typeOnly,
        sideEffectOnly: source.kind === 'side-effect',
        ...(source.hasValueUsage === undefined ? {} : { hasValueUsage: source.hasValueUsage }),
    };
}
