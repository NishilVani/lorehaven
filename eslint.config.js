import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Generated, vendored, or scratch trees.
  //
  // src-tauri/target is Rust build output. Cargo writes JavaScript in there —
  // tauri-codegen-assets, one file per bundled asset — and linting it produced
  // 149 parse errors that had nothing to do with this codebase. It never showed
  // up in CI because target/ is not checked out there, only on a machine that
  // has built the app.
  globalIgnores([
    'dist',
    'src-tauri/gen',
    'src-tauri/target',
    '.claude',
    '.agents',
    '.codex',
    '.github/skills',
    '.impeccable',
    'qa',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // `const { feel, ...rest } = entry` is how this codebase drops a key. The
      // extracted name is deliberately unused — it exists so the rest object
      // does not contain it. Without this option the idiom is unlintable.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  // Node, not the browser: build tooling, the test scripts, and the local
  // dev-server half of the Worker proxy, which reads process.env and Buffer.
  {
    files: [
      'vite.config.js',
      'scripts/**/*.{js,mjs}',
      'tests/**/*.{js,mjs}',
      'functions/**/*.{js,mjs}',
      'read_firestore.js',
      'test_wikidata.js',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
])
