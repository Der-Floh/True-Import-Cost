import { NodeTypes, parse } from '@vue/compiler-dom';
import { describe, expect, it } from 'vitest';

import { analyzeVue, templateIdentifiers } from '../../parser/vue';

import type { BindingUsage, SourceImport } from '../../parser/types';
import type { ElementNode } from '@vue/compiler-dom';

function bindingsOf(imports: readonly SourceImport[]): Map<string, BindingUsage> {
    return new Map(imports.flatMap(each => each.bindings).map(binding => [binding.local, binding]));
}

function identifiersIn(template: string): string[] {
    const root = parse(`<template>${template}</template>`, { parseMode: 'sfc', prefixIdentifiers: true });
    const element = root.children.find((node): node is ElementNode => node.type === NodeTypes.ELEMENT);
    return [...templateIdentifiers(element!)].sort();
}

const COMPONENT = `<script setup lang="ts">
import MyButton from './MyButton.vue';
import TheHeader from './TheHeader.vue';
import { UI } from './ui';
import { vFocus } from './directives/focus';
import { vClickOutside } from './directives/clickOutside';
import { formatDate } from './format';
import { items, entry } from './data';
import { attrName } from './attrs';
import { inputEl } from './refs';
import { count } from './store';
import { onSave } from './actions';
import { Dynamic } from './Dynamic.vue';
import { className } from './classes';
import { scriptOnly } from './script';
import { unused } from './unused';
import type { Props } from './types';

defineProps<Props>();
scriptOnly();
</script>

<template>
    <MyButton />
    <the-header />
    <UI.Panel />
    <input v-focus v-click-outside="close" ref="inputEl" />
    <p>{{ formatDate(now) }}</p>
    <ul><li v-for="entry in items">x</li></ul>
    <div :[attrName]="1" class="className" />
    <Counter :count />
    <form @submit="onSave" />
    <component :is="Dynamic" />
</template>
`;

describe('analyzeVue template usage', () => {
    const imports = analyzeVue(COMPONENT, { usage: true });
    const bindings = bindingsOf(imports);
    const templateReferences = (local: string) => bindings.get(local)?.templateReferences;

    it('recognises a component used by its PascalCase or kebab-case tag', () => {
        expect(templateReferences('MyButton')).toBe(1);
        expect(templateReferences('TheHeader')).toBe(1);
    });

    it('recognises the namespace of a namespaced component tag', () => {
        expect(templateReferences('UI')).toBe(1);
    });

    it('recognises custom directives by their v-prefixed camel-case name', () => {
        expect(templateReferences('vFocus')).toBe(1);
        expect(templateReferences('vClickOutside')).toBe(1);
    });

    it('recognises identifiers in interpolations, handlers, dynamic arguments and :is', () => {
        expect(['formatDate', 'onSave', 'attrName', 'Dynamic'].map(templateReferences)).toEqual([1, 1, 1, 1]);
    });

    it('recognises the source of a v-for but not its alias', () => {
        expect(templateReferences('items')).toBe(1);
        expect(templateReferences('entry')).toBe(0);
    });

    it('recognises a template ref and a same-name prop shorthand', () => {
        expect(templateReferences('inputEl')).toBe(1);
        expect(templateReferences('count')).toBe(1);
    });

    it('does not treat static attribute values as identifiers', () => {
        expect(templateReferences('className')).toBe(0);
    });

    it('counts template usage as value usage so the import is not reported as removable', () => {
        const byLocal = new Map(imports.map(each => [each.bindings[0]?.local, each]));

        expect(byLocal.get('MyButton')?.hasValueUsage).toBe(true);
        expect(byLocal.get('scriptOnly')).toMatchObject({ hasValueUsage: true, bindings: [expect.objectContaining({ valueReferences: 1, templateReferences: 0 })] });
        expect(byLocal.get('unused')?.hasValueUsage).toBe(false);
        expect(byLocal.get('Props')).toMatchObject({ typeOnly: true, hasValueUsage: false });
    });

    it('gives ranges in the original document', () => {
        const header = imports.find(each => each.specifier === './TheHeader.vue')!;

        expect(COMPONENT.slice(header.specifierRange.start, header.specifierRange.end)).toBe("'./TheHeader.vue'");
        expect(COMPONENT.slice(header.range.start, header.range.end)).toBe("import TheHeader from './TheHeader.vue';");
    });

    it('returns the imports in document order', () => {
        expect(imports.map(each => each.specifier).slice(0, 3)).toEqual(['./MyButton.vue', './TheHeader.vue', './ui']);
    });

    it('does not look at the template when usage analysis is off', () => {
        const plain = analyzeVue(COMPONENT, { usage: false });

        expect(plain).toHaveLength(imports.length);
        expect(plain.every(each => each.hasValueUsage === undefined && each.bindings.every(binding => binding.templateReferences === 0))).toBe(true);
    });
});

describe('analyzeVue script blocks', () => {
    it('reads a normal script and a script setup block, applying template usage to the setup block only', () => {
        const text = [
            '<script lang="ts">',
            "import Legacy from './Legacy.vue';",
            'export default { components: { Legacy } };',
            '</script>',
            '<script setup lang="ts">',
            "import Modern from './Modern.vue';",
            '</script>',
            '<template><Legacy /><Modern /></template>',
        ].join('\n');

        const imports = analyzeVue(text, { usage: true });
        const bindings = bindingsOf(imports);

        expect(imports.map(each => each.specifier)).toEqual(['./Legacy.vue', './Modern.vue']);
        expect(bindings.get('Legacy')).toMatchObject({ templateReferences: 0, valueReferences: 1, escapes: true });
        expect(bindings.get('Modern')).toMatchObject({ templateReferences: 1, valueReferences: 0 });
    });

    it('picks the script language from the lang attribute', () => {
        const ts = analyzeVue("<script setup lang=\"ts\">\nimport { a } from './a';\n</script>", { usage: true });
        const js = analyzeVue("<script setup>\nimport { a } from './a';\n</script>", { usage: true });
        const tsx = analyzeVue("<script setup lang=\"tsx\">\nimport { Icon } from './Icon';\nconst view = <Icon />;\n</script>", { usage: true });

        expect(ts[0]?.hasValueUsage).toBe(false);
        expect(js[0]?.hasValueUsage).toBeUndefined();
        expect(tsx[0]).toMatchObject({ hasValueUsage: true, bindings: [expect.objectContaining({ calls: 1 })] });
    });

    it('skips script blocks that load their content from a file', () => {
        expect(analyzeVue("<script src=\"./setup.ts\"></script>\n<script setup>\nimport { a } from './a';\n</script>", { usage: true }).map(each => each.specifier))
            .toEqual(['./a']);
    });

    it('ignores a template that loads its content from a file', () => {
        const imports = analyzeVue("<script setup lang=\"ts\">\nimport Foo from './Foo.vue';\n</script>\n<template src=\"./template.html\"><Foo /></template>", { usage: true });

        expect(imports[0]).toMatchObject({ hasValueUsage: false, bindings: [expect.objectContaining({ templateReferences: 0 })] });
    });

    it('returns nothing for a component without scripts', () => {
        expect(analyzeVue('<template><p>static</p></template>\n<style>p { color: red; }</style>', { usage: true })).toEqual([]);
        expect(analyzeVue('', { usage: true })).toEqual([]);
    });

    it.each([
        ['an unclosed element', '<template><div><span></span></template>'],
        ['an unfinished expression', '<template><button @click="count +">+</button></template>'],
    ])('still reads the script imports when the template has %s', (_, template) => {
        const text = `<script setup lang="ts">\nimport { count } from './store';\n</script>\n${template}`;

        expect(analyzeVue(text, { usage: true }).map(each => each.specifier)).toEqual(['./store']);
    });
});

describe('templateIdentifiers', () => {
    it('leaves out native elements and built-in tags', () => {
        expect(identifiersIn('<div><svg><path /></svg><template v-if="ok"><slot /></template><Transition><p /></Transition></div>')).toEqual(['ok']);
    });

    it('leaves out built-in directives but keeps their expressions', () => {
        expect(identifiersIn('<p v-if="visible" v-show="shown" v-model="state.text" v-html="raw" v-cloak>x</p>')).toEqual(['raw', 'shown', 'state', 'visible']);
    });

    it('leaves out identifiers that are local to an expression', () => {
        expect(identifiersIn('<button @click="(event) => handle(event)">{{ list.map(each => each.name) }}</button>')).toEqual(['handle', 'list']);
    });

    it('adds both the camel-case and the PascalCase form of a component tag', () => {
        expect(identifiersIn('<date-picker />')).toEqual(['DatePicker', 'datePicker']);
    });
});
