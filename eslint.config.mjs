import stylistic from '@stylistic/eslint-plugin';
import importX from 'eslint-plugin-import-x';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

const NODE_BUILTINS = [
    'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
    'path', 'node:path', 'os', 'node:os',
    'child_process', 'node:child_process',
    'crypto', 'node:crypto', 'buffer', 'node:buffer',
    'stream', 'node:stream', 'util', 'node:util',
    'url', 'node:url', 'zlib', 'node:zlib',
];

const noNodeBuiltins = message => NODE_BUILTINS.map(name => ({ name, message }));

const noVscode = message => ({ name: 'vscode', message });

export default tseslint.config(
    {
        ignores: ['out/**', 'public/**', 'node_modules/**', 'packages/*/dist/**', '.vscode-test/**', 'src/test/fixtures/**'],
    },

    {
        files: ['**/*.ts', '**/*.vue'],
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            '@stylistic': stylistic,
            'import-x': importX,
        },
        rules: {
            '@stylistic/indent': ['warn', 4, { SwitchCase: 1 }],
            '@stylistic/quotes': ['warn', 'single', { avoidEscape: true }],
            '@stylistic/semi': 'warn',
            '@stylistic/brace-style': ['warn', '1tbs'],
            '@stylistic/linebreak-style': ['warn', 'unix'],
            curly: 'warn',

            eqeqeq: ['warn', 'always', { null: 'ignore' }],
            'no-console': 'warn',
            'no-eval': 'error',
            'no-throw-literal': 'warn',
            'no-useless-return': 'warn',
            'no-var': 'error',
            'object-shorthand': 'warn',
            'prefer-const': 'warn',
            'prefer-template': 'warn',

            '@typescript-eslint/naming-convention': ['warn', {
                selector: 'import',
                format: ['camelCase', 'PascalCase'],
            }],
            '@typescript-eslint/consistent-type-imports': ['warn', {
                prefer: 'type-imports',
                fixStyle: 'inline-type-imports',
            }],
            '@typescript-eslint/no-require-imports': 'error',
            'import-x/order': ['warn', {
                groups: [['builtin', 'external', 'unknown'], ['internal', 'parent', 'sibling', 'index'], 'type'],
                pathGroupsExcludedImportTypes: ['type'],
                'newlines-between': 'always',
                alphabetize: { order: 'ignore' },
            }],
            'import-x/no-duplicates': 'warn',

            '@typescript-eslint/explicit-member-accessibility': ['error', {
                accessibility: 'explicit',
            }],
            '@typescript-eslint/parameter-properties': ['error', {
                prefer: 'class-property',
            }],

            '@typescript-eslint/no-wrapper-object-types': 'error',
            '@typescript-eslint/no-unsafe-function-type': 'error',
            '@typescript-eslint/no-empty-object-type': 'error',
            '@typescript-eslint/no-array-constructor': 'error',
            '@typescript-eslint/no-extra-non-null-assertion': 'error',
            '@typescript-eslint/no-misused-new': 'error',
            '@typescript-eslint/no-this-alias': 'warn',
            '@typescript-eslint/prefer-as-const': 'warn',
            '@typescript-eslint/no-unnecessary-type-constraint': 'warn',
            '@typescript-eslint/triple-slash-reference': 'off',
            '@typescript-eslint/no-duplicate-enum-values': 'error',

            'no-shadow': 'off',
            '@typescript-eslint/no-shadow': 'warn',
            '@typescript-eslint/ban-ts-comment': ['warn', {
                'ts-expect-error': 'allow-with-description',
                'ts-ignore': 'allow-with-description',
            }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-non-null-assertion': 'warn',
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
        },
    },

    {
        files: ['src/**/*.ts', 'src/**/*.vue'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.vue'],
            },
        },
        rules: {
            '@typescript-eslint/only-throw-error': 'warn',
            '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',

            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/require-await': 'warn',
            '@typescript-eslint/return-await': 'error',

            '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
            '@typescript-eslint/no-for-in-array': 'error',
            '@typescript-eslint/no-base-to-string': 'warn',
            '@typescript-eslint/no-unsafe-enum-comparison': 'warn',

            '@typescript-eslint/prefer-nullish-coalescing': 'warn',
            '@typescript-eslint/prefer-optional-chain': 'warn',
            '@typescript-eslint/prefer-includes': 'warn',
            '@typescript-eslint/prefer-string-starts-ends-with': 'warn',
        },
    },

    {
        files: ['src/core/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [
                    ...noNodeBuiltins('src/core runs in the extension host, in the bundler plugins and later in a CLI: use web-standard APIs only.'),
                    noVscode('src/core must not import vscode, so the bundler plugins and a CLI can reuse it.'),
                ],
                patterns: [
                    { group: ['**/parser', '**/parser/**', '**/extension/**', '**/plugins/**'], message: 'src/core is the bottom layer and imports nothing above it.' },
                ],
            }],
        },
    },
    {
        files: ['src/parser/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [
                    ...noNodeBuiltins('The parser analyses text it is given; it reads no files itself.'),
                    noVscode('src/parser must not import vscode, so it stays testable without mocks.'),
                ],
                patterns: [
                    { group: ['**/extension/**', '**/plugins/**'], message: 'src/parser may depend on src/core only.' },
                ],
            }],
        },
    },
    {
        files: ['src/extension/**/*.ts'],
        ignores: ['src/extension/services/parserHost.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: noNodeBuiltins('Use vscode.workspace.fs and vscode.Uri: they work for remote workspaces too.'),
                patterns: [
                    { group: ['**/plugins/**'], message: 'The bundler plugins are not part of the extension.' },
                ],
            }],
            '@typescript-eslint/no-restricted-imports': ['error', {
                patterns: [
                    {
                        group: ['**/parser', '**/parser/**'],
                        allowTypeImports: true,
                        message: 'The parser is its own lazily loaded bundle: import its types here, and load it through services/parserHost.ts.',
                    },
                ],
            }],
        },
    },
    {
        // Measuring an import runs the user's build, which takes a child process on the machine that holds the workspace.
        files: ['src/extension/measure/buildRunner.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: noNodeBuiltins('Use vscode.workspace.fs and vscode.Uri: they work for remote workspaces too.')
                    .filter(entry => !entry.name.endsWith('child_process')),
                patterns: [
                    { group: ['**/plugins/**'], message: 'The bundler plugins are not part of the extension.' },
                ],
            }],
        },
    },
    {
        files: ['src/driver/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [noVscode('The drivers run in a Node process of their own, outside VS Code.')],
                patterns: [
                    { group: ['**/extension/**', '**/parser', '**/parser/**', '**/plugins/**', '**/webview/**'], message: 'The drivers may depend on src/core only.' },
                ],
            }],
        },
    },
    {
        files: ['src/shared/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [
                    ...noNodeBuiltins('src/shared loads in the webview too: use web-standard APIs only.'),
                    noVscode('src/shared must not import vscode: the webview imports it too.'),
                ],
                patterns: [
                    { group: ['**/extension/**', '**/webview/**', '**/parser', '**/parser/**', '**/plugins/**'], message: 'src/shared is the contract between the host and the webview and depends on neither.' },
                ],
            }],
        },
    },
    {
        files: ['src/webview/**/*.ts', 'src/webview/**/*.vue'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [
                    ...noNodeBuiltins('The webview runs in a browser.'),
                    noVscode('The webview talks to the host only through src/webview/vscode.ts.'),
                ],
                patterns: [
                    { group: ['**/extension/**', '**/parser', '**/parser/**', '**/plugins/**'], message: 'The webview may use src/shared and the pure modules of src/core only.' },
                ],
            }],
        },
    },
    {
        files: ['src/plugins/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [
                    noVscode('The bundler plugins run in the user\'s build, where vscode does not exist.'),
                ],
                patterns: [
                    { group: ['**/extension/**', '**/parser', '**/parser/**'], message: 'The bundler plugins may depend on src/core only.' },
                ],
            }],
        },
    },
    {
        files: ['src/test/**/*.ts'],
        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },

    ...pluginVue.configs['flat/recommended'],
    {
        files: ['**/*.vue'],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser,
                ecmaVersion: 2022,
                sourceType: 'module',
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.vue'],
            },
        },
        rules: {
            'vue/html-indent': ['warn', 4],
            'vue/max-attributes-per-line': ['warn', { singleline: { max: 5 }, multiline: { max: 1 } }],
            'vue/html-self-closing': ['warn', { html: { void: 'any', normal: 'always', component: 'always' } }],
            'vue/singleline-html-element-content-newline': 'off',
            'vue/no-v-html': 'error',
        },
    },
    {
        // The one place markup is injected: codicon SVGs imported at build time, never data from the model.
        files: ['src/webview/components/CodiconIcon.vue'],
        rules: {
            'vue/no-v-html': 'off',
        },
    },
);
