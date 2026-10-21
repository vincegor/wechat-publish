import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'] },

    // App source
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
            // The renderer intentionally injects theme-authored HTML.
            '@typescript-eslint/no-explicit-any': 'off',
            // `_`-prefixed params document a required-but-unused signature slot.
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            }],
        },
    },

    // Build/tooling config + browser tests run in Node
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['*.ts', 'e2e/**/*.ts'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: { ...globals.node, ...globals.browser },
        },
    },
)
