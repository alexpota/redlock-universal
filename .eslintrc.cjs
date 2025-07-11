module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  extends: [
    'eslint:recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint', 'prettier', 'deprecation', 'sonarjs'],
  rules: {
    // Prettier integration
    'prettier/prettier': 'error',
    
    // Basic TypeScript
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    
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
    
    // Deprecated methods and APIs
    'deprecation/deprecation': 'error',
    
    // String methods
    '@typescript-eslint/prefer-string-starts-ends-with': 'error',
    
    // Code quality and duplication detection
    'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
    'sonarjs/no-duplicated-branches': 'error',
    'sonarjs/no-identical-functions': 'error',
  },
  overrides: [
    // Test files
    {
      files: ['**/*.{test,spec}.ts', 'tests/**/*.ts'],
      env: {
        node: true,
      },
      parserOptions: {
        project: null, // Disable project for test files to avoid TSConfig issues
      },
      rules: {
        // More relaxed rules for tests
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        'no-console': 'off',
        'deprecation/deprecation': 'off', // Disable deprecation rule for tests since project is null
        '@typescript-eslint/prefer-string-starts-ends-with': 'off', // Disable TypeScript rules requiring project
        'sonarjs/no-duplicate-string': 'off', // Disable for test files - less critical than source code
      },
    },
    // Config files and examples
    {
      files: ['*.config.{js,ts,cjs,mjs}', '.eslintrc.cjs', 'examples/**/*.ts'],
      env: {
        node: true,
      },
      parserOptions: {
        project: null, // Disable project for config files and examples
      },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-console': 'off',
        'deprecation/deprecation': 'off',
        '@typescript-eslint/prefer-string-starts-ends-with': 'off',
      },
    },
  ],
};