import type * as Parser from '../../parser';

type ParserModule = typeof Parser;

let loading: Promise<ParserModule> | undefined;

export function loadParser(): Promise<ParserModule> {
    loading ??= import('../../parser/index.js');
    return loading;
}
