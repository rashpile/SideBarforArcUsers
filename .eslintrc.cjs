module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'releases', 'tmp', 'node_modules'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: {
    // A leading underscore marks a parameter or variable that is unused on purpose
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // Parsers loop with while (true) and break out
    'no-constant-condition': ['error', { checkLoops: false }],
  },
  overrides: [
    { files: ['*.cjs', '*.config.*', 'tools/**', 'tests/**'], env: { node: true } },
  ],
};
