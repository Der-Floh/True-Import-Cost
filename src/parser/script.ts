import ts from 'typescript';

import type { BindingUsage, MemberUsage, MemberUsageKind, ScriptLanguage, SourceImport, SourceImportKind, TextRange } from './types';

export interface ScriptOptions {
    readonly usage: boolean;
    readonly elidesUnusedImports: boolean;
    readonly offset?: number;
    readonly templateIdentifiers?: ReadonlySet<string>;
}

interface PendingBinding {
    readonly local: string;
    readonly imported: string;
    readonly typeOnly: boolean;
    readonly declaration: ts.Identifier;
}

interface PendingImport {
    readonly specifier: string;
    readonly kind: SourceImportKind;
    readonly typeOnly: boolean;
    readonly node: ts.Node;
    readonly literal: ts.Node;
    readonly bindings: readonly PendingBinding[];
}

interface MutableUsage {
    valueReferences: number;
    typeReferences: number;
    templateReferences: number;
    calls: number;
    members: Map<string, MemberUsageKind>;
    escapes: boolean;
    dynamicAccess: boolean;
}

const FILE_NAMES: Readonly<Record<ScriptLanguage, string>> = {
    ts: '/document.ts',
    tsx: '/document.tsx',
    js: '/document.js',
    jsx: '/document.jsx',
};

const SCRIPT_KINDS: Readonly<Record<ScriptLanguage, ts.ScriptKind>> = {
    ts: ts.ScriptKind.TS,
    tsx: ts.ScriptKind.TSX,
    js: ts.ScriptKind.JS,
    jsx: ts.ScriptKind.JSX,
};

const COMPILER_OPTIONS: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    types: [],
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
};

const MEMBER_KIND_RANK: Readonly<Record<MemberUsageKind, number>> = { call: 3, construct: 2, access: 1, destructure: 0 };

function createChecker(sourceFile: ts.SourceFile): ts.TypeChecker {
    const host: ts.CompilerHost = {
        getSourceFile: fileName => (fileName === sourceFile.fileName ? sourceFile : undefined),
        getDefaultLibFileName: () => '/lib.d.ts',
        writeFile: () => undefined,
        getCurrentDirectory: () => '/',
        getCanonicalFileName: fileName => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: fileName => fileName === sourceFile.fileName,
        readFile: () => undefined,
    };
    return ts.createProgram({ rootNames: [sourceFile.fileName], options: COMPILER_OPTIONS, host }).getTypeChecker();
}

function nameText(name: ts.ModuleExportName | ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return undefined;
}

function stringArgument(node: ts.CallExpression): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined {
    const argument = node.arguments[0];
    return argument !== undefined && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) ? argument : undefined;
}

function collectStaticImport(statement: ts.ImportDeclaration): PendingImport | undefined {
    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
        return undefined;
    }
    const clause = statement.importClause;
    const base = { specifier: statement.moduleSpecifier.text, node: statement, literal: statement.moduleSpecifier };
    if (!clause) {
        return { ...base, kind: 'side-effect', typeOnly: false, bindings: [] };
    }

    const clauseTypeOnly = clause.isTypeOnly;
    const bindings: PendingBinding[] = [];
    let kind: SourceImportKind = 'named';
    if (clause.name) {
        bindings.push({ local: clause.name.text, imported: 'default', typeOnly: clauseTypeOnly, declaration: clause.name });
        kind = 'default';
    }
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
        bindings.push({ local: named.name.text, imported: '*', typeOnly: clauseTypeOnly, declaration: named.name });
        kind = 'namespace';
    } else if (named) {
        for (const element of named.elements) {
            bindings.push({
                local: element.name.text,
                imported: nameText(element.propertyName ?? element.name) ?? element.name.text,
                typeOnly: clauseTypeOnly || element.isTypeOnly,
                declaration: element.name,
            });
        }
        if (named.elements.length > 0) {
            kind = 'named';
        }
    }
    const typeOnly = clauseTypeOnly || (bindings.length > 0 && bindings.every(binding => binding.typeOnly));
    return { ...base, kind, typeOnly, bindings };
}

function collectExport(statement: ts.ExportDeclaration): PendingImport | undefined {
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
        return undefined;
    }
    const clause = statement.exportClause;
    const base = { specifier: statement.moduleSpecifier.text, node: statement, literal: statement.moduleSpecifier, bindings: [] };
    if (!clause) {
        return { ...base, kind: 'export-all', typeOnly: statement.isTypeOnly };
    }
    if (ts.isNamespaceExport(clause)) {
        return { ...base, kind: 're-export', typeOnly: statement.isTypeOnly };
    }
    const typeOnly = statement.isTypeOnly || (clause.elements.length > 0 && clause.elements.every(element => element.isTypeOnly));
    return { ...base, kind: 're-export', typeOnly };
}

function bindingsFromPattern(pattern: ts.ObjectBindingPattern): PendingBinding[] {
    const bindings: PendingBinding[] = [];
    for (const element of pattern.elements) {
        if (!ts.isIdentifier(element.name)) {
            continue;
        }
        const imported = element.dotDotDotToken ? '*' : nameText(element.propertyName ?? element.name) ?? element.name.text;
        bindings.push({ local: element.name.text, imported, typeOnly: false, declaration: element.name });
    }
    return bindings;
}

function collectCall(call: ts.CallExpression, kind: 'dynamic' | 'require', literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): PendingImport {
    const value: ts.Node = ts.isAwaitExpression(call.parent) ? call.parent : call;
    const holder = value.parent;
    const base = { specifier: literal.text, typeOnly: false, literal };
    if (ts.isVariableDeclaration(holder) && holder.initializer === value) {
        const statement = ts.isVariableDeclarationList(holder.parent) && ts.isVariableStatement(holder.parent.parent) ? holder.parent.parent : holder;
        const bindings = ts.isIdentifier(holder.name)
            ? [{ local: holder.name.text, imported: '*', typeOnly: false, declaration: holder.name }]
            : ts.isObjectBindingPattern(holder.name) ? bindingsFromPattern(holder.name) : [];
        return { ...base, kind, node: kind === 'dynamic' ? call : statement, bindings };
    }
    if (kind === 'require' && ts.isExpressionStatement(holder)) {
        return { ...base, kind: 'side-effect', node: holder, bindings: [] };
    }
    return { ...base, kind, node: call, bindings: [] };
}

function isShadowedRequire(call: ts.CallExpression, checker: () => ts.TypeChecker): boolean {
    const symbol = checker().getSymbolAtLocation(call.expression);
    return (symbol?.declarations?.length ?? 0) > 0;
}

function collectImports(sourceFile: ts.SourceFile, checker: () => ts.TypeChecker): PendingImport[] {
    const imports: PendingImport[] = [];
    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
            const found = collectStaticImport(statement);
            if (found) {
                imports.push(found);
            }
        } else if (ts.isExportDeclaration(statement)) {
            const found = collectExport(statement);
            if (found) {
                imports.push(found);
            }
        } else if (
            ts.isImportEqualsDeclaration(statement)
            && ts.isExternalModuleReference(statement.moduleReference)
            && ts.isStringLiteral(statement.moduleReference.expression)
        ) {
            imports.push({
                specifier: statement.moduleReference.expression.text,
                kind: 'import-equals',
                typeOnly: statement.isTypeOnly,
                node: statement,
                literal: statement.moduleReference.expression,
                bindings: [{ local: statement.name.text, imported: '*', typeOnly: statement.isTypeOnly, declaration: statement.name }],
            });
        }
    }

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const literal = stringArgument(node);
            if (literal && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                imports.push(collectCall(node, 'dynamic', literal));
            } else if (
                literal
                && node.arguments.length === 1
                && ts.isIdentifier(node.expression)
                && node.expression.text === 'require'
                && !isShadowedRequire(node, checker)
            ) {
                imports.push(collectCall(node, 'require', literal));
            }
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);

    return imports.sort((a, b) => a.node.getStart(sourceFile) - b.node.getStart(sourceFile));
}

function isTypeHeritage(node: ts.ExpressionWithTypeArguments): boolean {
    const clause = node.parent;
    if (!ts.isHeritageClause(clause)) {
        return true;
    }
    return clause.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(clause.parent);
}

function isInTypePosition(identifier: ts.Identifier): boolean {
    let node: ts.Node = identifier;
    while (node.parent) {
        const parent: ts.Node = node.parent;
        if (ts.isExpressionWithTypeArguments(parent)) {
            return isTypeHeritage(parent);
        }
        if (ts.isTypeNode(parent)) {
            return true;
        }
        if (ts.isQualifiedName(parent) || (ts.isPropertyAccessExpression(parent) && parent.expression === node)) {
            node = parent;
            continue;
        }
        return false;
    }
    return false;
}

function symbolOfReference(identifier: ts.Identifier, checker: ts.TypeChecker): ts.Symbol | undefined {
    const parent = identifier.parent;
    if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) {
        return checker.getShorthandAssignmentValueSymbol(parent);
    }
    if (ts.isExportSpecifier(parent)) {
        const local = parent.propertyName ?? parent.name;
        return local === identifier ? checker.getExportSpecifierLocalTargetSymbol(parent) : undefined;
    }
    return checker.getSymbolAtLocation(identifier);
}

function recordMember(usage: MutableUsage, name: string, kind: MemberUsageKind): void {
    const previous = usage.members.get(name);
    if (previous === undefined || MEMBER_KIND_RANK[kind] > MEMBER_KIND_RANK[previous]) {
        usage.members.set(name, kind);
    }
}

function memberKindOf(access: ts.Expression): MemberUsageKind {
    const holder = access.parent;
    if ((ts.isCallExpression(holder) || ts.isTaggedTemplateExpression(holder)) && (ts.isCallExpression(holder) ? holder.expression : holder.tag) === access) {
        return 'call';
    }
    if (ts.isNewExpression(holder) && holder.expression === access) {
        return 'construct';
    }
    return 'access';
}

function classifyValueReference(identifier: ts.Identifier, usage: MutableUsage): void {
    const parent = identifier.parent;

    if (ts.isPropertyAccessExpression(parent) && parent.expression === identifier) {
        recordMember(usage, parent.name.text, memberKindOf(parent));
        return;
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === identifier) {
        const argument = parent.argumentExpression;
        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument) || ts.isNumericLiteral(argument)) {
            recordMember(usage, argument.text, memberKindOf(parent));
        } else {
            usage.dynamicAccess = true;
            usage.escapes = true;
        }
        return;
    }
    if ((ts.isCallExpression(parent) && parent.expression === identifier) || (ts.isTaggedTemplateExpression(parent) && parent.tag === identifier)) {
        usage.calls++;
        return;
    }
    if (ts.isNewExpression(parent) && parent.expression === identifier) {
        usage.calls++;
        return;
    }
    if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) && parent.tagName === identifier) {
        if (!ts.isJsxClosingElement(parent)) {
            usage.calls++;
        }
        return;
    }
    if (ts.isTypeOfExpression(parent) || ts.isDeleteExpression(parent) || ts.isVoidExpression(parent)) {
        return;
    }
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && parent.right === identifier) {
        return;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === identifier && ts.isObjectBindingPattern(parent.name)) {
        for (const element of parent.name.elements) {
            const key = element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined);
            const name = element.dotDotDotToken || key === undefined ? undefined : nameText(key);
            if (name === undefined) {
                usage.escapes = true;
            } else {
                recordMember(usage, name, 'destructure');
            }
        }
        return;
    }
    usage.escapes = true;
}

function analyzeUsage(
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    bindings: readonly PendingBinding[],
    templateIdentifiers: ReadonlySet<string> | undefined,
): Map<PendingBinding, MutableUsage> {
    const usages = new Map<PendingBinding, MutableUsage>();
    const bySymbol = new Map<ts.Symbol, PendingBinding>();
    const names = new Set<string>();
    const declarations = new Set<ts.Node>();
    for (const binding of bindings) {
        usages.set(binding, {
            valueReferences: 0,
            typeReferences: 0,
            templateReferences: templateIdentifiers?.has(binding.local) ? 1 : 0,
            calls: 0,
            members: new Map(),
            escapes: false,
            dynamicAccess: false,
        });
        declarations.add(binding.declaration);
        names.add(binding.local);
        const symbol = checker.getSymbolAtLocation(binding.declaration);
        if (symbol) {
            bySymbol.set(symbol, binding);
        }
    }

    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
            if (names.has(node.text) && !declarations.has(node)) {
                const symbol = symbolOfReference(node, checker);
                const binding = symbol === undefined ? undefined : bySymbol.get(symbol);
                const usage = binding === undefined ? undefined : usages.get(binding);
                if (usage) {
                    if (isInTypePosition(node)) {
                        usage.typeReferences++;
                    } else {
                        usage.valueReferences++;
                        classifyValueReference(node, usage);
                    }
                }
            }
            return;
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return usages;
}

function toRange(node: ts.Node, sourceFile: ts.SourceFile, offset: number): TextRange {
    return { start: node.getStart(sourceFile) + offset, end: node.getEnd() + offset };
}

function toMembers(members: ReadonlyMap<string, MemberUsageKind>): MemberUsage[] {
    return [...members.entries()].map(([name, kind]) => ({ name, kind }));
}

const VALUE_KINDS: ReadonlySet<SourceImportKind> = new Set(['default', 'named', 'namespace', 'import-equals']);

export function analyzeScript(text: string, language: ScriptLanguage, options: ScriptOptions): SourceImport[] {
    const offset = options.offset ?? 0;
    const sourceFile = ts.createSourceFile(FILE_NAMES[language], text, ts.ScriptTarget.Latest, true, SCRIPT_KINDS[language]);
    let checker: ts.TypeChecker | undefined;
    const lazyChecker = (): ts.TypeChecker => (checker ??= createChecker(sourceFile));
    const pending = collectImports(sourceFile, lazyChecker);
    const usages = options.usage
        ? analyzeUsage(sourceFile, lazyChecker(), pending.flatMap(item => item.bindings), options.templateIdentifiers)
        : undefined;

    return pending.map((item): SourceImport => {
        const bindings: BindingUsage[] = item.bindings.map((binding) => {
            const usage = usages?.get(binding);
            return {
                local: binding.local,
                imported: binding.imported,
                typeOnly: binding.typeOnly,
                valueReferences: usage?.valueReferences ?? 0,
                typeReferences: usage?.typeReferences ?? 0,
                templateReferences: usage?.templateReferences ?? 0,
                calls: usage?.calls ?? 0,
                members: usage ? toMembers(usage.members) : [],
                escapes: usage?.escapes ?? false,
                dynamicAccess: usage?.dynamicAccess ?? false,
            };
        });
        const hasValueUsage = usages === undefined || !options.elidesUnusedImports || !VALUE_KINDS.has(item.kind)
            ? undefined
            : bindings.some(binding => !binding.typeOnly && binding.valueReferences + binding.templateReferences > 0);
        return {
            specifier: item.specifier,
            kind: item.kind,
            typeOnly: item.typeOnly,
            range: toRange(item.node, sourceFile, offset),
            specifierRange: toRange(item.literal, sourceFile, offset),
            bindings,
            ...(hasValueUsage === undefined ? {} : { hasValueUsage }),
        };
    });
}
