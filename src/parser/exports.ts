import ts from 'typescript';

import { isInTypePosition, parseScript, singleFileProgram, stringArgument } from './script';

import type { ExportAnalysis, ReExport, ScriptLanguage } from './types';

interface ImportedBinding {
    readonly specifier: string;
    readonly imported: string;
}

interface ExportCollection {
    readonly local: Set<string>;
    readonly reExports: Map<string, ReExport>;
    readonly exportAll: string[];
    readonly reExportedBindings: Set<string>;
}

interface BodyScan {
    readonly referencedBindings: Set<string>;
    readonly calledSpecifiers: string[];
    commonJs: boolean;
}

const UNKNOWN: ExportAnalysis = { kind: 'unknown' };

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(modifier => modifier.kind === kind) ?? false);
}

function isModuleSyntax(statement: ts.Statement): boolean {
    return ts.isImportDeclaration(statement)
        || ts.isExportDeclaration(statement)
        || ts.isExportAssignment(statement)
        || hasModifier(statement, ts.SyntaxKind.ExportKeyword);
}

function specifierOf(node: ts.Expression | undefined): string | undefined {
    return node !== undefined && ts.isStringLiteral(node) ? node.text : undefined;
}

function valueBindingsOf(clause: ts.ImportClause): [local: string, imported: string][] {
    if (clause.isTypeOnly) {
        return [];
    }
    const bindings: [string, string][] = clause.name ? [[clause.name.text, 'default']] : [];
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
        bindings.push([named.name.text, '*']);
    } else if (named) {
        for (const element of named.elements) {
            if (!element.isTypeOnly) {
                bindings.push([element.name.text, (element.propertyName ?? element.name).text]);
            }
        }
    }
    return bindings;
}

function importedBindings(sourceFile: ts.SourceFile): Map<string, ImportedBinding> {
    const bindings = new Map<string, ImportedBinding>();
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !statement.importClause) {
            continue;
        }
        const specifier = specifierOf(statement.moduleSpecifier);
        if (specifier === undefined) {
            continue;
        }
        for (const [local, imported] of valueBindingsOf(statement.importClause)) {
            bindings.set(local, { specifier, imported });
        }
    }
    return bindings;
}

function bindingNames(name: ts.BindingName, names: string[]): string[] {
    if (ts.isIdentifier(name)) {
        names.push(name.text);
    } else {
        for (const element of name.elements) {
            if (!ts.isOmittedExpression(element)) {
                bindingNames(element.name, names);
            }
        }
    }
    return names;
}

function declaredNames(statement: ts.Statement): string[] {
    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.flatMap(declaration => bindingNames(declaration.name, []));
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
        if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
            return ['default'];
        }
        return statement.name ? [statement.name.text] : [];
    }
    if (ts.isEnumDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
        return [statement.name.text];
    }
    if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
        return [statement.name.text];
    }
    return [];
}

function collectExports(sourceFile: ts.SourceFile, bindings: ReadonlyMap<string, ImportedBinding>): ExportCollection | undefined {
    const collection: ExportCollection = { local: new Set(), reExports: new Map(), exportAll: [], reExportedBindings: new Set() };
    const reExport = (name: string, imported: string, specifier: string): void => {
        if (!collection.reExports.has(name)) {
            collection.reExports.set(name, { name, imported, specifier });
        }
    };
    const exportLocal = (name: string, local: string): void => {
        const binding = bindings.get(local);
        if (binding) {
            reExport(name, binding.imported, binding.specifier);
            collection.reExportedBindings.add(local);
        } else {
            collection.local.add(name);
        }
    };

    for (const statement of sourceFile.statements) {
        if (ts.isExportDeclaration(statement)) {
            if (statement.isTypeOnly) {
                continue;
            }
            const specifier = specifierOf(statement.moduleSpecifier);
            const clause = statement.exportClause;
            if (!clause) {
                if (specifier !== undefined) {
                    collection.exportAll.push(specifier);
                }
            } else if (ts.isNamespaceExport(clause)) {
                if (specifier !== undefined) {
                    reExport(clause.name.text, '*', specifier);
                }
            } else {
                for (const element of clause.elements.filter(each => !each.isTypeOnly)) {
                    const source = (element.propertyName ?? element.name).text;
                    if (specifier === undefined) {
                        exportLocal(element.name.text, source);
                    } else {
                        reExport(element.name.text, source, specifier);
                    }
                }
            }
        } else if (ts.isExportAssignment(statement)) {
            if (statement.isExportEquals) {
                return undefined;
            }
            if (ts.isIdentifier(statement.expression)) {
                exportLocal('default', statement.expression.text);
            } else {
                collection.local.add('default');
            }
        } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword) && !hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) {
            for (const name of declaredNames(statement)) {
                collection.local.add(name);
            }
        }
    }
    return collection;
}

function isMemberName(parent: ts.Node, identifier: ts.Identifier): boolean {
    if (ts.isQualifiedName(parent)) {
        return parent.right === identifier;
    }
    if (ts.isBindingElement(parent)) {
        return parent.propertyName === identifier;
    }
    if (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) {
        return parent.label === identifier;
    }
    return (ts.isPropertyAccessExpression(parent)
        || ts.isPropertyAssignment(parent)
        || ts.isMethodDeclaration(parent)
        || ts.isPropertyDeclaration(parent)
        || ts.isGetAccessorDeclaration(parent)
        || ts.isSetAccessorDeclaration(parent)
        || ts.isPropertySignature(parent)
        || ts.isMethodSignature(parent)
        || ts.isEnumMember(parent)
        || ts.isJsxAttribute(parent)
        || ts.isMetaProperty(parent)) && parent.name === identifier;
}

function isReference(identifier: ts.Identifier): boolean {
    const parent = identifier.parent;
    return !isMemberName(parent, identifier)
        && !ts.isImportClause(parent)
        && !ts.isImportSpecifier(parent)
        && !ts.isNamespaceImport(parent)
        && !ts.isImportEqualsDeclaration(parent)
        && !ts.isExportSpecifier(parent)
        && !ts.isNamespaceExport(parent)
        && !ts.isExportAssignment(parent)
        && !isInTypePosition(identifier);
}

function isModuleExports(identifier: ts.Identifier): boolean {
    const parent = identifier.parent;
    return identifier.text === 'module' && ts.isPropertyAccessExpression(parent) && parent.expression === identifier && parent.name.text === 'exports';
}

function isImportOrRequire(call: ts.CallExpression): boolean {
    return call.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(call.expression) && call.expression.text === 'require');
}

function scanBody(sourceFile: ts.SourceFile, bindings: ReadonlyMap<string, ImportedBinding>): BodyScan {
    const scan: BodyScan = { referencedBindings: new Set(), calledSpecifiers: [], commonJs: false };
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
            if (isReference(node)) {
                if (bindings.has(node.text)) {
                    scan.referencedBindings.add(node.text);
                }
                if (node.text === 'exports' || isModuleExports(node)) {
                    scan.commonJs = true;
                }
            }
            return;
        }
        if (ts.isCallExpression(node) && isImportOrRequire(node)) {
            const literal = stringArgument(node);
            if (literal) {
                scan.calledSpecifiers.push(literal.text);
            }
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return scan;
}

function onlyCarriesReExports(clause: ts.ImportClause, reExported: ReadonlySet<string>, referenced: ReadonlySet<string>): boolean {
    const locals = valueBindingsOf(clause).map(([local]) => local);
    return locals.every(local => reExported.has(local) && !referenced.has(local));
}

function ownImports(sourceFile: ts.SourceFile, reExported: ReadonlySet<string>, scan: BodyScan): string[] {
    const own = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
            const specifier = specifierOf(statement.moduleSpecifier);
            const clause = statement.importClause;
            if (specifier !== undefined && (!clause || !onlyCarriesReExports(clause, reExported, scan.referencedBindings))) {
                own.add(specifier);
            }
        } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly && ts.isExternalModuleReference(statement.moduleReference)) {
            const specifier = specifierOf(statement.moduleReference.expression);
            if (specifier !== undefined) {
                own.add(specifier);
            }
        }
    }
    for (const specifier of scan.calledSpecifiers) {
        own.add(specifier);
    }
    return [...own];
}

export function analyzeModuleExports(text: string, language: ScriptLanguage): ExportAnalysis {
    const sourceFile = parseScript(text, language);
    if (!sourceFile.statements.some(isModuleSyntax) || singleFileProgram(sourceFile).getSyntacticDiagnostics(sourceFile).length > 0) {
        return UNKNOWN;
    }
    const bindings = importedBindings(sourceFile);
    const exports = collectExports(sourceFile, bindings);
    const scan = scanBody(sourceFile, bindings);
    if (!exports || scan.commonJs) {
        return UNKNOWN;
    }
    return {
        kind: 'esm',
        local: [...exports.local],
        reExports: [...exports.reExports.values()],
        exportAll: [...new Set(exports.exportAll)],
        ownImports: ownImports(sourceFile, exports.reExportedBindings, scan),
    };
}
