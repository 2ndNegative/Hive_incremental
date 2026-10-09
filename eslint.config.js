// WHAT THE LINTER IS FOR HERE, and what it is deliberately not for.
//
// This is a game written by one person across many sessions, and the class of
// mistake that actually happens is not "inconsistent quote style" — it is a
// symbol that stopped being used three refactors ago and is still imported, an
// export nothing reaches any more, a typo'd identifier in a branch nobody runs.
// An audit of this codebase turned up fourteen dead exports and eleven unused
// imports; every one of them would have been caught here, for free, on save.
//
// So: NO STYLE RULES. Nothing about semicolons, indentation, quotes, line
// length or trailing commas. Those are arguments, the editor already handles
// them, and a linter that shouts about spacing trains you to stop reading it —
// at which point it stops catching the things that matter too.
//
// Everything switched on below is either a real defect or a thing the next
// person will read as a lie about the code.

import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'build/**',
      '.single-build/**',
      'deprecated/**',
      'node_modules/**',
      'HiveIdle.html',
      'tests/.shots/**',
      'Claude outputs/**',
    ],
  },

  js.configs.recommended,
  ...vue.configs['flat/recommended'],

  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'unused-imports': unusedImports },
    rules: {
      // THE POINT OF THE WHOLE FILE. An import kept after its last use is a
      // claim that this module depends on that one, and the next person reading
      // the dependency graph believes it.
      'unused-imports/no-unused-imports': 'error',

      // Unused locals are a warning rather than an error, because a half-written
      // function with a variable not wired up yet is a normal state to be in
      // mid-edit and should not fail a build. Arguments are exempt entirely:
      // a callback that ignores its second parameter is correct and common.
      'no-unused-vars': 'off',
      'unused-imports/no-unused-vars': ['warn', {
        vars: 'all',
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],

      // Real defects, all of them silent at runtime until they are not.
      'no-undef': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-constant-binary-expression': 'error',
      'no-promise-executor-return': 'error',
      'require-atomic-updates': 'error',
      'no-await-in-loop': 'off', // the test suites do this on purpose, in order

      // `==` against null is the one coercion worth keeping: it catches
      // undefined too, which is usually what the author meant.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // An empty catch is how this codebase says "storage may be unreadable and
      // that is fine" — see save.js. It is a deliberate idiom, so it is allowed,
      // but an empty if or loop body is still a mistake.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // The engine mutates state in place everywhere, by design.
      'no-param-reassign': 'off',
    },
  },

  {
    // Vue: the rules that catch a broken render, not the ones that reformat a
    // template. Attribute order and self-closing style are the linter having an
    // opinion; a v-for without a key is a list that reorders wrongly.
    files: ['**/*.vue'],
    rules: {
      'vue/require-v-for-key': 'error',
      'vue/no-use-v-if-with-v-for': 'error',
      'vue/no-mutating-props': 'error',
      'vue/no-side-effects-in-computed-properties': 'error',
      'vue/no-unused-components': 'error',
      'vue/require-valid-default-prop': 'error',

      'vue/attributes-order': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/multi-word-component-names': 'off', // App.vue, TopBar.vue — fine
    },
  },

  {
    // The suites drive a real browser and reach into `hive`, the debug handle
    // main.js hangs on window. It is global by construction and there is no
    // import to declare it with.
    files: ['tests/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, hive: 'readonly' } },
  },
];
