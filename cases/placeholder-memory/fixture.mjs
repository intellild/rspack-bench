import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const cases = [
  'runtime-template',
  'css-native-sri',
  'css-extract-auto-sri',
  'css-extract-relative',
  'url-relative',
  'url-worker',
  'modern-module',
  'module-preserve',
  'rstest',
  'node-external',
];
export async function generate(root, count, rules) {
  for (const dir of [
    'assets',
    'styles',
    'native',
    'extract',
    'urls',
    'modern',
    'rstest',
    'node',
  ])
    await mkdir(path.join(root, dir), { recursive: true });
  const put = (name, content) => writeFile(path.join(root, name), content);
  await put(
    'package.json',
    JSON.stringify({ name: 'placeholder-memory-fixture', private: true }),
  );
  const entries = Object.fromEntries(
    ['native', 'extract', 'urls', 'modern', 'rstest', 'node'].map((x) => [
      x,
      [],
    ]),
  );
  for (let i = 0; i < count; i++) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><text>${i}</text></svg>`;
    await Promise.all(
      ['', '.base', '.keep', '.inline'].map((suffix) =>
        put(`assets/image-${i}${suffix}.svg`, svg),
      ),
    );
    const css =
      Array.from(
        { length: rules },
        (_, j) =>
          `.rule${j} { color: rgb(${i % 255}, ${j % 255}, 80); background-image: url('../assets/image-${i}.svg'); mask-image: url('../assets/image-${i}.base.svg'); }`,
      ).join('\n') +
      `\n.inline { background: url('../assets/image-${i}.inline.svg'); }\n`;
    await Promise.all([
      put(`styles/style-${i}.module.css`, css),
      put(`styles/text-${i}.css`, css),
    ]);
    await put(
      `native/module-${i}.js`,
      `import * as styles from '../styles/style-${i}.module.css';\nimport text from '../styles/text-${i}.css';\nglobalThis.native${i} = [styles, text];\n`,
    );
    await put(
      `extract/module-${i}.js`,
      `import * as styles from '../styles/style-${i}.module.css';\nglobalThis.extract${i} = styles;\n`,
    );
    await put(
      `urls/module-${i}.js`,
      `export const url${i} = new URL('../assets/image-${i}.svg', import.meta.url);\nglobalThis.url${i} = url${i};\n`,
    );
    await put(
      `modern/module-${i}.js`,
      `import kept from '../assets/image-${i}.keep.svg';\nimport image from '../assets/image-${i}.svg';\nimport common from './common-${i}.cjs';\nexport const value${i} = [kept, image, common, new URL('../assets/image-${i}.svg', import.meta.url)];\n`,
    );
    await put(
      `modern/common-${i}.cjs`,
      `module.exports = require('../assets/image-${i}.keep.svg');\n`,
    );
    await put(`rstest/dep-${i}.js`, `export default ${i};\n`);
    const mockSource = `const hoisted${i} = rs.hoisted(() => ({ value: ${i} }));\nrs.mock('./dep-${i}.js', () => ({ default: hoisted${i}.value }));\nrs.unmock('node:os');\nrs.mockRequire('node:path', () => ({ value: ${i} }));\nimport value${i} from './dep-${i}.js';\nglobalThis.mock${i} = value${i};\n`;
    await put(`rstest/module-${i}.js`, mockSource);
    await put(
      `node/module-${i}.js`,
      `const fs = require('fs'); const prefixed = require('node:fs');\nconst strict = require('assert/strict');\nconst local = require('./node:local');\nexports.value = [fs === prefixed, strict, local, () => require('pnpapi'), () => require('node:rspack-future-builtin')];\n`,
    );
    for (const kind of Object.keys(entries))
      entries[kind].push(
        kind === 'rstest'
          ? mockSource
          : kind === 'modern'
            ? `export { value${i} } from './module-${i}.js';`
            : `import './module-${i}.js';`,
      );
  }
  await put('node/local.js', 'module.exports = 42;\n');
  for (const [kind, imports] of Object.entries(entries)) {
    if (['native', 'extract', 'modern'].includes(kind)) {
      const split = Math.ceil(count / 2),
        lazy = imports.slice(split),
        chunkSize = Math.max(1, Math.ceil(lazy.length / 16));
      const main = imports.slice(0, split);
      for (let i = 0; i < lazy.length; i += chunkSize) {
        const id = Math.floor(i / chunkSize);
        await put(
          `${kind}/lazy-${id}.js`,
          lazy.slice(i, i + chunkSize).join('\n'),
        );
        main.push(
          `globalThis.load_${kind}_${id} = () => import(/* webpackChunkName: "lazy-${id}" */ './lazy-${id}.js');`,
        );
      }
      await put(`${kind}/index.js`, main.join('\n'));
    } else await put(`${kind}/index.js`, imports.join('\n'));
  }
  const workers = Math.min(16, count);
  for (let i = 0; i < workers; i++)
    await put(
      `urls/batch-${i}.js`,
      entries.urls.filter((_, n) => n % workers === i).join('\n'),
    );
  let workerEntry = `export * from './index.js';\n`;
  for (let i = 0; i < workers; i++) {
    await put(
      `urls/worker-${i}.js`,
      `self.postMessage(new URL('../assets/image-${i}.svg', import.meta.url).href);\n`,
    );
    workerEntry += `globalThis.worker${i} = new Worker(/* webpackChunkName: "worker-${i}" */ new URL('./worker-${i}.js', import.meta.url), { type: 'module' });\n`;
  }
  await put('urls/with-workers.js', workerEntry);
  await put(
    'modern/with-workers.js',
    `export * from './index.js';\nimport '../urls/with-workers.js';\n`,
  );
}
