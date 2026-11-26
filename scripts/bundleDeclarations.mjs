import path from 'node:path';

import ts from 'typescript';

function ancestorsOf(file) {
    const directory = path.dirname(file);
    return directory === file ? [] : [directory, ...ancestorsOf(directory)];
}

function inMemoryHost(files, options) {
    const host = ts.createCompilerHost(options);
    const directories = new Set([...files.keys()].flatMap(file => ancestorsOf(file)));
    return {
        ...host,
        directoryExists: directory => directories.has(path.resolve(directory)) || ts.sys.directoryExists(directory),
        fileExists: fileName => files.has(path.resolve(fileName)) || host.fileExists(fileName),
        readFile: fileName => files.get(path.resolve(fileName)) ?? host.readFile(fileName),
        getSourceFile: (fileName, languageVersion, ...rest) => {
            const text = files.get(path.resolve(fileName));
            return text === undefined ? host.getSourceFile(fileName, languageVersion, ...rest) : ts.createSourceFile(fileName, text, languageVersion, true);
        },
    };
}

function topLevelStatement(node) {
    let current = node;
    while (!ts.isSourceFile(current.parent)) {
        current = current.parent;
    }
    return current;
}

function leftmostName(name) {
    return ts.isQualifiedName(name) ? leftmostName(name.left) : ts.isPropertyAccessExpression(name) ? leftmostName(name.expression) : name;
}

function referencedNames(node, found = []) {
    if (ts.isImportTypeNode(node)) {
        throw new Error(`An inline import type cannot be bundled: ${node.getText()}`);
    }
    const name = ts.isTypeReferenceNode(node) ? node.typeName
        : ts.isExpressionWithTypeArguments(node) ? node.expression
            : ts.isTypeQueryNode(node) ? node.exprName : undefined;
    if (name !== undefined) {
        found.push(leftmostName(name));
    }
    ts.forEachChild(node, (child) => {
        referencedNames(child, found);
    });
    return found;
}

function externalImportOf(symbol) {
    const declaration = symbol.declarations?.[0];
    const statement = declaration === undefined ? undefined : topLevelStatement(declaration);
    if (statement === undefined || !ts.isImportDeclaration(statement) || /^\.\.?\//.test(statement.moduleSpecifier.text)) {
        return undefined;
    }
    const source = statement.moduleSpecifier.text;
    if (ts.isNamespaceImport(declaration)) {
        return `import type * as ${symbol.name} from '${source}';`;
    }
    const imported = ts.isImportSpecifier(declaration) ? (declaration.propertyName ?? declaration.name).text : 'default';
    return imported === symbol.name ? `import type { ${imported} } from '${source}';` : `import type { ${imported} as ${symbol.name} } from '${source}';`;
}

function declaredNames(statement) {
    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.map(declaration => declaration.name.getText());
    }
    return statement.name === undefined ? [] : [statement.name.text];
}

function statementText(statement, exported) {
    const sourceFile = statement.getSourceFile();
    const start = statement.getStart(sourceFile, true);
    const keyword = statement.modifiers?.find(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported || keyword === undefined) {
        return sourceFile.text.slice(start, statement.end);
    }
    return sourceFile.text.slice(start, keyword.getStart(sourceFile)) + sourceFile.text.slice(keyword.end, statement.end).trimStart();
}

function assertSelfContained(text, fileName, options) {
    const program = ts.createProgram([fileName], { ...options, noEmit: true, skipLibCheck: false }, inMemoryHost(new Map([[fileName, text]]), options));
    const sourceFile = program.getSourceFile(fileName);
    const diagnostics = [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)];
    if (diagnostics.length > 0) {
        throw new Error(`The bundled declaration does not stand on its own:\n${ts.formatDiagnostics(diagnostics, {
            getCanonicalFileName: name => name,
            getCurrentDirectory: () => path.dirname(fileName),
            getNewLine: () => '\n',
        })}\n${text}`);
    }
}

export function bundleDeclarations(files, entry, options) {
    const program = ts.createProgram([...files.keys()], { ...options, noEmit: true }, inMemoryHost(files, options));
    const checker = program.getTypeChecker();
    const resolve = symbol => ((symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol));
    const exported = new Set();
    const included = new Set();
    const imports = new Set();

    const include = (symbol) => {
        for (const declaration of resolve(symbol).declarations ?? []) {
            if (ts.isSourceFile(declaration)) {
                throw new Error(`${symbol.name} is a namespace import of ${declaration.fileName}, which cannot be bundled.`);
            }
            const statement = topLevelStatement(declaration);
            if (!included.has(statement) && files.has(path.resolve(statement.getSourceFile().fileName))) {
                included.add(statement);
                for (const name of referencedNames(statement)) {
                    const referenced = checker.getSymbolAtLocation(name);
                    const external = referenced === undefined ? undefined : externalImportOf(referenced);
                    if (external !== undefined) {
                        imports.add(external);
                    } else if (referenced !== undefined) {
                        include(referenced);
                    }
                }
            }
        }
    };

    for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(entry)))) {
        const declarations = (resolve(symbol).declarations ?? []).filter(declaration => files.has(path.resolve(declaration.getSourceFile().fileName)));
        if (resolve(symbol).name !== symbol.name || declarations.length === 0) {
            throw new Error(`${entry} exports ${symbol.name}, which is renamed or declared outside the project; such exports cannot be bundled.`);
        }
        declarations.forEach(declaration => exported.add(topLevelStatement(declaration)));
        include(symbol);
    }

    const statements = program.getSourceFiles().flatMap(sourceFile => sourceFile.statements.filter(statement => included.has(statement)));
    const owners = new Map();
    for (const statement of statements) {
        for (const name of declaredNames(statement)) {
            const owner = owners.get(name) ?? statement.getSourceFile();
            if (owner !== statement.getSourceFile()) {
                throw new Error(`${name} is declared in ${owner.fileName} and in ${statement.getSourceFile().fileName}, so their declarations cannot be bundled into one file.`);
            }
            owners.set(name, owner);
        }
    }

    const text = `${[...imports, ...statements.map(statement => statementText(statement, exported.has(statement)))].join('\n')}\n`;
    assertSelfContained(text, path.join(path.dirname(entry), 'bundle.d.ts'), options);
    return text;
}
