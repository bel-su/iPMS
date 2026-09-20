import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `.next` holds generated bundles and route type stubs. Linting them
    // reports a few hundred problems in code nobody wrote or can fix, which
    // buries any real finding in the sources beside it.
    ignores: ['**/node_modules/**', '**/dist/**', '**/.nx/**', '**/.next/**'],
  },
  {
    files: ['libs/**/*.ts', 'apps/**/*.ts'],
    extends: [...tseslint.configs.recommended],
  },
);
