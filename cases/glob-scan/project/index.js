globalThis.__globReleaseAB = import.meta.glob([
  './src/packages/*/pages/{index,about}.mjs',
  './src/plugins/*/pages/{index,about}.mjs',
  '!./src/packages/disabled-*/pages/about.mjs',
  '!./src/unrelated/**/*.mjs',
], { eager: true, import: 'default', query: '?glob-ab' });
