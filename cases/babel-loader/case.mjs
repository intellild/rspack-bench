import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createConfig as baseConfig } from '../noop-loader/config.mjs';

export const description = 'Babel parses and prints the same JS module graph as the no-loader baseline. No presets, plugins, external Babel config, source maps, or Babel cache.';
export const moduleType = 'javascript/auto';
export const resourceName = i => `module-${String(i).padStart(5, '0')}.js`;

export async function prepareFixture({ root, dir, modules, linesPerModule = 0 }) {
  // Reuse the existing full-size JS graph when available.
  let previous;
  try {
    const run = (await readFile(path.join(root, 'results/latest-noop-loader.txt'), 'utf8')).trim();
    const manifest = JSON.parse(await readFile(path.join(run, 'fixture.json'), 'utf8'));
    if (linesPerModule === 0 && manifest.modules === modules) previous = { fixture: path.join(run, 'fixture'), fileHashes: manifest.fileHashes };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous) {
    for (const [name, digest] of Object.entries(previous.fileHashes)) {
      assert.equal(createHash('sha256').update(await readFile(path.join(previous.fixture, name))).digest('hex'), digest);
    }
    return { ...previous, origin: 'Reused existing noop-loader JS fixture' };
  }
  assert(Number.isSafeInteger(linesPerModule) && linesPerModule >= 0);
  const fixture = path.join(dir, 'fixture'), fileHashes = {};
  const functionsPerModule = linesPerModule ? Math.ceil(linesPerModule / 14) : 0;
  let expectedChecksum = 0, totalBytes = 0, minLines = Infinity, maxLines = 0;
  for (let i = 0; i < modules; i++) {
    const children = [2 * i + 1, 2 * i + 2].filter(id => id < modules);
    let source = children.map((id, index) => `import { value as child${index} } from './${resourceName(id)}';`).join('\n') +
      `\nexport const value = ${i}${children.map((_, index) => ` + child${index}`).join('')};\n`;
    if (functionsPerModule) {
      // Executable data-processing functions, not comments or blank-line padding.
      // Each module evaluates every function and exports a checksum for validation.
      for (let fn = 0; fn < functionsPerModule; fn++) {
        source += [
          `function compute${fn}(input) {`,
          `  const record = { value: input, label: 'item', enabled: true };`,
          `  const { value, label } = record;`,
          `  const entries = [value, label.length, 2];`,
          `  const mapped = entries.map(item => item + 1);`,
          `  const total = mapped.reduce((sum, item) => sum + item, 0);`,
          `  const metadata = { nested: { total }, active: record.enabled };`,
          `  const result = metadata.nested?.total ?? 0;`,
          `  if (!metadata.active) {`,
          `    return 0;`,
          `  }`,
          `  const output = { result, key: label + value };`,
          `  return output.result;`,
          `}`, ''
        ].join('\n');
        expectedChecksum += i + fn + 9;
      }
      source += `export const checksum = ${Array.from({ length: functionsPerModule }, (_, fn) => `compute${fn}(${i + fn})`).join(' + ')}${children.map((_, index) => ` + checksum${index}`).join('')};\n`;
      source = children.map((id, index) => `import { checksum as checksum${index} } from './${resourceName(id)}';`).join('\n') + '\n' + source;
    }
    const lines = source.split('\n').length - 1;
    minLines = Math.min(minLines, lines); maxLines = Math.max(maxLines, lines);
    totalBytes += Buffer.byteLength(source);
    await writeFile(path.join(fixture, resourceName(i)), source);
    fileHashes[resourceName(i)] = createHash('sha256').update(source).digest('hex');
  }
  return { fixture, fileHashes, linesPerModule, functionsPerModule, expectedChecksum, totalBytes, minLines, maxLines, origin: 'Generated binary-tree JS fixture' };
}

export function createConfig(job, req, timingPlugin) {
  const loaderPath = req.resolve('babel-loader');
  const config = baseConfig(null, { ...job, noop: false }, timingPlugin);
  config.output.uniqueName = 'babel-loader-bench';
  config.module.rules[0].use = job.loaded ? [{ loader: loaderPath, parallel: false, options: {
    babelrc: false, configFile: false, cacheDirectory: false, sourceMaps: false,
    presets: [], plugins: [], comments: false, compact: false, minified: false,
  } }] : [];
  return { config, loaderPath, expectedDependencies: { 'babel-loader': '10.1.1', '@babel/core': '7.29.7' } };
}

export function instrumentCompiler(req) {
  const audit = { calls: 0, resources: new Set() };
  const transformPath = req.resolve('babel-loader/lib/transform');
  const original = req(transformPath);
  const counted = async function (source, options) {
    const result = await original(source, options);
    assert.equal(typeof result?.code, 'string', 'Babel must parse and generate every module');
    audit.calls++;
    audit.resources.add(options.filename);
    return result;
  };
  Object.assign(counted, original);
  req.cache[transformPath].exports = counted;
  return audit;
}

export async function validateOutput(job, details, runInNewContext) {
  assert.deepEqual(details.assets.map(asset => asset.name), ['main.js']);
  const bundle = await readFile(path.join(job.output, 'main.js'), 'utf8');
  const module = { exports: {} };
  runInNewContext(bundle, { module, exports: module.exports }, { timeout: 30000 });
  assert.equal(module.exports.value, job.modules * (job.modules - 1) / 2);
  return { exportedValue: module.exports.value };
}
