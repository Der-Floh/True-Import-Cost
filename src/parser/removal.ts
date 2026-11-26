import ts from 'typescript';

import type { SourceImport } from './types';

export interface PlannedRemoval {
    readonly start: number;
    readonly end: number;
    readonly expected: string;
    readonly replacement: string;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function parseStatement(text: string): ts.Statement | undefined {
    return ts.createSourceFile('removal.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).statements[0];
}

function declarations(names: readonly { readonly local: string; readonly empty: 'object' | 'undefined' }[]): string {
    return names.map(({ local, empty }) => `${local} = ${empty === 'object' ? '{}' : 'void 0'}`).join(', ');
}

function staticImportReplacement(source: SourceImport): string | undefined {
    const values = source.bindings.filter(binding => !binding.typeOnly);
    if (values.length === 0) {
        return undefined;
    }
    return `const ${declarations(values.map(binding => ({ local: binding.local, empty: binding.imported === '*' ? 'object' : 'undefined' })))};`;
}

function reExportReplacement(statement: string): string | undefined {
    const parsed = parseStatement(statement);
    if (!parsed || !ts.isExportDeclaration(parsed) || parsed.isTypeOnly || !parsed.exportClause) {
        return undefined;
    }
    const clause = parsed.exportClause;
    if (ts.isNamespaceExport(clause)) {
        return ts.isIdentifier(clause.name) ? `export const ${clause.name.text} = {};` : undefined;
    }
    const names = clause.elements.filter(element => !element.isTypeOnly).map(element => element.name);
    if (names.length === 0 || names.some(name => !ts.isIdentifier(name))) {
        return undefined;
    }
    const exported = names.map(name => (name as ts.Identifier).text);
    const named = exported.filter(name => name !== 'default');
    const parts = [
        ...(named.length > 0 ? [`export const ${declarations(named.map(local => ({ local, empty: 'undefined' })))};`] : []),
        ...(exported.includes('default') ? ['export default void 0;'] : []),
    ];
    return parts.join(' ');
}

function importEqualsReplacement(statement: string, source: SourceImport): string | undefined {
    const local = source.bindings[0]?.local;
    if (local === undefined || !IDENTIFIER.test(local)) {
        return undefined;
    }
    return `${/^export\s/.test(statement) ? 'export ' : ''}const ${local} = {};`;
}

function requireCall(node: ts.Node, specifier: string): ts.CallExpression | undefined {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const argument = node.arguments[0];
        if (argument !== undefined && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) && argument.text === specifier) {
            return node;
        }
    }
    return ts.forEachChild(node, child => requireCall(child, specifier));
}

function requireReplacement(statement: string, source: SourceImport): string | undefined {
    const parsed = parseStatement(statement);
    if (!parsed) {
        return undefined;
    }
    if (ts.isExpressionStatement(parsed) && parsed.expression.getText() === statement.replace(/;\s*$/, '')) {
        return '({})';
    }
    const call = requireCall(parsed, source.specifier);
    if (!call) {
        return undefined;
    }
    const start = call.getStart();
    return `${statement.slice(0, start)}{}${statement.slice(call.getEnd())}`;
}

function replacementFor(statement: string, source: SourceImport): string | undefined {
    switch (source.kind) {
        case 'side-effect':
            return ';';
        case 'default':
        case 'named':
        case 'namespace':
            return staticImportReplacement(source);
        case 're-export':
            return reExportReplacement(statement);
        case 'import-equals':
            return importEqualsReplacement(statement, source);
        case 'dynamic':
            return 'Promise.resolve({})';
        case 'require':
            return requireReplacement(statement, source);
        case 'export-all':
            return undefined;
    }
}

export function planRemoval(text: string, source: SourceImport): PlannedRemoval | undefined {
    if (source.typeOnly) {
        return undefined;
    }
    const { start, end } = source.range;
    const expected = text.slice(start, end);
    const replacement = replacementFor(expected, source);
    return replacement === undefined ? undefined : { start, end, expected, replacement };
}
