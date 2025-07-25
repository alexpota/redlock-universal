export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // New features
        'fix',      // Bug fixes
        'docs',     // Documentation changes
        'style',    // Code style changes (formatting, etc.)
        'refactor', // Code refactoring
        'test',     // Adding or updating tests
        'chore',    // Maintenance tasks
        'perf',     // Performance improvements
        'ci',       // CI/CD changes
        'build',    // Build system changes
        'revert'    // Reverting changes
      ]
    ],
    'subject-case': [0], // Disabled - allow any case
    'subject-max-length': [2, 'always', 72],
    'body-max-line-length': [0],  // Disable body line length check for semantic-release compatibility
    'footer-max-line-length': [0]  // Disable footer line length check for semantic-release compatibility
  }
};