import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.{js,cjs,mjs}'],
  },

  // Base recommended rules
  eslint.configs.recommended,

  // Source files with type-checked linting
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      sonarjs,
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',

      // Replaces eslint-plugin-deprecation
      '@typescript-eslint/no-deprecated': 'error',

      // String methods
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',

      // Performance and best practices
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',

      // Security
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // Error prevention
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-alert': 'error',

      // Import/Export
      'no-duplicate-imports': 'error',

      // SonarJS
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      'sonarjs/no-duplicated-branches': 'error',
      'sonarjs/no-identical-functions': 'error',
    },
  },

  // Test files — relaxed rules, no type checking
  {
    files: ['**/*.{test,spec}.ts', 'tests/**/*.ts'],
    extends: [...tseslint.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },

  // Example files — no type checking
  {
    files: ['examples/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Logger file — allow console
  {
    files: ['src/monitoring/Logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Prettier must be LAST to override formatting rules
  eslintPluginPrettierRecommended,
);
