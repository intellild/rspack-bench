import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function componentDependencies(index, count) {
  const children = [index * 2 + 1, index * 2 + 2].filter(id => id < count);
  if (index > 0) {
    const sibling = index % 2 === 1 ? index + 1 : index - 1;
    children.push(sibling < count ? sibling : Math.floor((index - 1) / 2));
  }
  return [...new Set(children)];
}

export async function generateFixture({ modules = 10000, styles = 'less' } = {}) {
  assert(Number.isSafeInteger(modules) && modules > 0);
  assert(['less', 'css'].includes(styles));
  const fixture = path.join(root, 'fixture');
  await rm(fixture, { recursive: true, force: true });
  await mkdir(path.join(fixture, 'styles'), { recursive: true });
  await mkdir(path.join(fixture, 'components'), { recursive: true });
  const filename = i => `style-${String(i).padStart(5, '0')}.module.${styles}`;
  const componentName = i => `Component${String(i).padStart(5, '0')}`;
  // Bounded concurrency, entirely before spawning any timed worker.
  for (let base = 0; base < modules; base += 128) {
    await Promise.all(Array.from({ length: Math.min(128, modules - base) }, (_, n) => {
      const i = base + n;
      const css =
        `.bench_${i} { color: #123456; margin: 0; padding: 1px; }\n` +
        `.bench_${i}:hover { color: #654321; margin: 1px; padding: 0; }\n` +
        `.bench_${i} > span { display: block; width: 10px; height: 10px; }\n`;
      const less = `@base: #123456;\n@hover: #654321;\n@gap: 1px;\n` +
        `.dimensions(@size) { display: block; width: @size; height: @size; }\n` +
        `.bench_${i} {\n  color: @base; margin: 0; padding: @gap;\n` +
        `  &:hover { color: @hover; margin: @gap; padding: 0; }\n` +
        `  > span { .dimensions((5px * 2)); }\n}\n`;
      const dependencies = componentDependencies(i, modules);
      const component = `import * as styles from '../styles/${filename(i)}';\n` +
        dependencies.map(id => `import ${componentName(id)} from './${componentName(id)}.jsx';`).join('\n') + '\n' +
        `export default function ${componentName(i)}({ depth = 0 } = {}) {\n` +
        `  return <section className={styles.bench_${i}} data-component={${i}}>\n` +
        `    <span>Component ${i}</span>\n` +
        dependencies.map(id => `    {depth > 0 && <${componentName(id)} depth={depth - 1} />}`).join('\n') +
        '\n  </section>;\n}\n';
      return Promise.all([
        writeFile(path.join(fixture, 'styles', filename(i)), styles === 'less' ? less : css),
        writeFile(path.join(fixture, 'components', `${componentName(i)}.jsx`), component),
      ]);
    }));
  }
  await writeFile(path.join(fixture, 'index.js'), Array.from({ length: modules }, (_, i) =>
    `import ${componentName(i)} from './components/${componentName(i)}.jsx';`).join('\n') +
    `\nexport const components = [${Array.from({ length: modules }, (_, i) => componentName(i)).join(', ')}];\n`);
  const groupCount = Math.min(100, Math.ceil(Math.sqrt(modules)));
  const sharedCount = Math.min(100, Math.max(1, Math.floor(modules / 10)));
  const sectionCount = Math.min(10, groupCount);
  await mkdir(path.join(fixture, 'topology', 'groups'), { recursive: true });
  await mkdir(path.join(fixture, 'topology', 'sections'), { recursive: true });
  for (let group = 0; group < groupCount; group++) {
    const ids = new Set(Array.from({ length: sharedCount }, (_, i) => i));
    for (let i = group; i < modules; i += groupCount) ids.add(i);
    await writeFile(path.join(fixture, 'topology', 'groups', `group-${group}.js`),
      [...ids].map(i => `export { default as ${componentName(i)} } from '../../components/${componentName(i)}.jsx';`).join('\n') + '\n');
  }
  for (let section = 0; section < sectionCount; section++) {
    const imports = [];
    for (let group = section; group < groupCount; group += sectionCount) imports.push(`export * as group${group} from '../groups/group-${group}.js';`);
    await writeFile(path.join(fixture, 'topology', 'sections', `section-${section}.js`), imports.join('\n') + '\n');
  }
  await writeFile(path.join(fixture, 'topology', 'index.js'), Array.from({ length: sectionCount }, (_, i) =>
    `import * as section${i} from './sections/section-${i}.js';`).join('\n') +
    `\nconst sections = [${Array.from({ length: sectionCount }, (_, i) => `section${i}`).join(', ')}];\n` +
    `const registry = Object.assign({}, ...sections.flatMap(section => Object.values(section)));\n` +
    `export const components = [${Array.from({ length: modules }, (_, i) => `registry.${componentName(i)}`).join(', ')}];\n`);
  return { modules, reactComponents: modules, cssModules: modules, styles,
    componentGraph: 'Binary tree children plus sibling back-references; isolated final sibling links to parent', rulesPerFile: 3, declarationsPerRule: 3,
    lessFeatures: styles === 'less' ? ['variables', 'parametric mixin', 'nested selectors', 'arithmetic'] : [],
    topology: { groupCount, sectionCount, sharedCount }, ...await fingerprintFixture() };
}

export async function fingerprintFixture() {
  const base = path.join(root, 'fixture');
  const files = [];
  async function walk(dir) {
    for (const item of await readdir(path.join(base, dir), { withFileTypes: true })) {
      const name = path.join(dir, item.name);
      if (item.isDirectory()) await walk(name);
      else files.push(name);
    }
  }
  await walk('');
  files.sort();
  const digest = createHash('sha256');
  const fileHashes = {};
  for (const file of files) {
    const bytes = await readFile(path.join(base, file));
    fileHashes[file] = hash(bytes);
    digest.update(file + '\0' + fileHashes[file] + '\n');
  }
  return { sha256: digest.digest('hex'), fileHashes };
}
