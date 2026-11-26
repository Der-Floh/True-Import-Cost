import { NodeTypes, parse, parserOptions, walkIdentifiers } from '@vue/compiler-dom';

import { analyzeScript } from './script';

import type { AnalyzeOptions, ScriptLanguage, SourceImport } from './types';
import type { AttributeNode, DirectiveNode, ElementNode, ExpressionNode, RootNode, TemplateChildNode } from '@vue/compiler-dom';

const BUILT_IN_DIRECTIVES = new Set(['bind', 'cloak', 'else-if', 'else', 'for', 'html', 'if', 'model', 'on', 'once', 'pre', 'show', 'slot', 'text', 'memo', 'is']);

const BUILT_IN_TAGS = new Set(['template', 'slot', 'component']);

function camelize(value: string): string {
    return value.replace(/-(\w)/g, (_, character: string) => character.toUpperCase());
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function addExpressionIdentifiers(ids: Set<string>, expression: ExpressionNode | undefined): void {
    if (!expression) {
        return;
    }
    if (expression.type === NodeTypes.SIMPLE_EXPRESSION && expression.ast) {
        walkIdentifiers(expression.ast, identifier => ids.add(identifier.name));
        return;
    }
    for (const match of expression.loc.source.matchAll(/[A-Za-z_$][\w$]*/g)) {
        ids.add(match[0]);
    }
}

function isComponentTag(tag: string): boolean {
    return !parserOptions.isNativeTag?.(tag) && !parserOptions.isBuiltInComponent?.(tag) && !BUILT_IN_TAGS.has(tag);
}

function visitDirective(ids: Set<string>, directive: DirectiveNode): void {
    if (!BUILT_IN_DIRECTIVES.has(directive.name)) {
        ids.add(`v${capitalize(camelize(directive.name))}`);
    }
    if (directive.arg && !(directive.arg.type === NodeTypes.SIMPLE_EXPRESSION && directive.arg.isStatic)) {
        addExpressionIdentifiers(ids, directive.arg);
    }
    if (directive.name === 'for' && directive.forParseResult) {
        addExpressionIdentifiers(ids, directive.forParseResult.source);
    } else if (directive.exp) {
        addExpressionIdentifiers(ids, directive.exp);
    } else if (directive.name === 'bind' && directive.arg?.type === NodeTypes.SIMPLE_EXPRESSION) {
        ids.add(camelize(directive.arg.content));
    }
}

function visitAttribute(ids: Set<string>, attribute: AttributeNode): void {
    if (attribute.name === 'ref' && attribute.value?.content) {
        ids.add(attribute.value.content);
    }
}

function visit(ids: Set<string>, node: TemplateChildNode): void {
    if (node.type === NodeTypes.ELEMENT) {
        const tag = node.tag.includes('.') ? (node.tag.split('.')[0] ?? node.tag).trim() : node.tag;
        if (isComponentTag(tag)) {
            ids.add(camelize(tag));
            ids.add(capitalize(camelize(tag)));
        }
        for (const prop of node.props) {
            if (prop.type === NodeTypes.DIRECTIVE) {
                visitDirective(ids, prop);
            } else {
                visitAttribute(ids, prop);
            }
        }
        node.children.forEach(child => visit(ids, child));
    } else if (node.type === NodeTypes.INTERPOLATION) {
        addExpressionIdentifiers(ids, node.content);
    }
}

export function templateIdentifiers(template: ElementNode): Set<string> {
    const ids = new Set<string>();
    template.children.forEach(child => visit(ids, child));
    return ids;
}

function findAttribute(element: ElementNode, name: string): AttributeNode | undefined {
    return element.props.find((prop): prop is AttributeNode => prop.type === NodeTypes.ATTRIBUTE && prop.name === name);
}

function languageOf(lang: string | undefined): ScriptLanguage {
    switch (lang) {
        case 'ts':
        case 'mts':
        case 'cts':
            return 'ts';
        case 'tsx':
            return 'tsx';
        case 'jsx':
            return 'jsx';
        default:
            return 'js';
    }
}

export function analyzeVue(text: string, options: AnalyzeOptions): SourceImport[] {
    let root: RootNode;
    try {
        root = parse(text, { parseMode: 'sfc', prefixIdentifiers: true, comments: false });
    } catch {
        return [];
    }
    const elements = root.children.filter((node): node is ElementNode => node.type === NodeTypes.ELEMENT);
    const template = elements.find(element => element.tag === 'template' && findAttribute(element, 'src') === undefined);
    let usedInTemplate: Set<string> | undefined;

    const imports: SourceImport[] = [];
    for (const script of elements.filter(element => element.tag === 'script' && findAttribute(element, 'src') === undefined)) {
        const content = script.children[0];
        if (content?.type !== NodeTypes.TEXT) {
            continue;
        }
        const setup = findAttribute(script, 'setup') !== undefined;
        if (setup && template && options.usage) {
            usedInTemplate ??= templateIdentifiers(template);
        }
        const language = languageOf(findAttribute(script, 'lang')?.value?.content);
        imports.push(...analyzeScript(content.content, language, {
            usage: options.usage,
            elidesUnusedImports: language === 'ts' || language === 'tsx',
            offset: content.loc.start.offset,
            ...(setup && usedInTemplate ? { templateIdentifiers: usedInTemplate } : {}),
        }));
    }
    return imports.sort((a, b) => a.range.start - b.range.start);
}
