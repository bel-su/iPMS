import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.nx/**'],
  },
  {
    files: ['libs/**/*.ts', 'apps/**/*.ts'],
    extends: [...tseslint.configs.recommended],
  },
);
