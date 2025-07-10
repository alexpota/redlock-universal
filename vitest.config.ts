import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Environment
    environment: 'node',
    
    // Test files
    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    
    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{test,spec}.ts',
        'src/**/*.d.ts',
        'src/**/index.ts', // Re-exports only
      ],
      thresholds: {
        global: {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
      },
    },
    
    // Performance
    testTimeout: 10000, // 10s timeout for integration tests
    hookTimeout: 10000,
    
    // Reporter
    reporter: process.env.CI ? 'verbose' : 'default',
    
    // Setup
    setupFiles: [],
    
    // Globals (avoid for better tree-shaking)
    globals: false,
  },
  
  // TypeScript
  esbuild: {
    target: 'es2022',
  },
});