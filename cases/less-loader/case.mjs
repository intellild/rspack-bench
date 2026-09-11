import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConfig as baseConfig } from '../noop-loader/config.mjs';

export const description = '10,000 Less/CSS workload modules by default, plus one JS entry importing every stylesheet. Less variables, mixins, nesting and arithmetic compile through less-loader to native CSS; baseline uses equivalent CSS precompiled outside build timers.';
export const moduleType = 'css';
export const compareCss = true;
export const resourceName = (i, loaded) => `style-${String(i).padStart(5, '0')}.${loaded ? 'less' : 'css'}`;

// less-loader 13 dynamically imports Less's ESM entry.
export function dependencyEntry(name, req) {
  return name === 'less'
    ? path.resolve(path.dirname(req.resolve('less')), '../lib/less-node/index.js')
    : req.resolve(name);
}

export async function prepareFixture({ root, dir, modules }) {
  const req = createRequire(path.join(root, 'versions/v2/package.json'));
  const less = (await import(pathToFileURL(dependencyEntry('less', req)).href)).default;
  assert.equal(less.version.join('.'), '4.9.1');
  const fixture = path.join(dir, 'fixture'), fileHashes = {};
  let reused = 0;
  const save = async (name, source) => {
    await writeFile(path.join(fixture, name), source);
    fileHashes[name] = createHash('sha256').update(source).digest('hex');
  };
  for (let i = 0; i < modules; i++) {
    let source;
    try {
      source = await readFile(path.join(root, 'fixture/styles', `style-${String(i).padStart(5, '0')}.module.less`), 'utf8');
      reused++;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      source = '@base: #123456;\n@hover: #654321;\n@gap: 1px;\n' +
        '.dimensions(@size) { display: block; width: @size; height: @size; }\n' +
        `.bench_${i} { color: @base; margin: 0; padding: @gap;\n` +
        '  &:hover { color: @hover; margin: @gap; padding: 0; }\n' +
        '  > span { .dimensions((5px * 2)); }\n}\n';
    }
    const css = (await less.render(source, { filename: path.join(fixture, resourceName(i, true)), math: 'parens-division' })).css;
    await save(resourceName(i, true), source);
    await save(resourceName(i, false), css);
  }
  for (const loaded of [false, true]) {
    await save(`index-${loaded ? 'less' : 'css'}.js`, Array.from({ length: modules }, (_, i) =>
      `import './${resourceName(i, loaded)}';`).join('\n') + `\nexport const value = ${modules};\n`);
  }
  return { fixture, fileHashes, reusedLessFiles: reused, origin: 'Existing Less inputs copied from fixture/styles when available; matching CSS precompiled once outside timers' };
}

export function createConfig(job, req, timingPlugin) {
  const loaderPath = req.resolve('less-loader');
  const config = baseConfig(null, { ...job, noop: false }, timingPlugin);
  config.entry = `./index-${job.loaded ? 'less' : 'css'}.js`;
  config.output.uniqueName = 'less-loader-bench';
  config.output.cssFilename = 'main.css';
  config.module.rules = [{ test: /\.(?:less|css)$/, include: job.fixture, type: 'css',
    use: job.loaded ? [{ loader: loaderPath, parallel: false, options: {
      sourceMap: false, lessOptions: { math: 'parens-division' },
    } }] : [] }];
  return { config, loaderPath, expectedDependencies: { 'less-loader': '13.0.0', less: '4.9.1' } };
}

export function instrumentCompiler(req) {
  const audit = { calls: 0, resources: new Set() };
  const utils = req('./utils.js'), original = utils.getLessImplementation;
  const patched = new WeakSet();
  utils.getLessImplementation = async function (...args) {
    const less = await original(...args);
    assert.equal(less.version.join('.'), '4.9.1');
    if (!patched.has(less)) {
      patched.add(less);
      const render = less.render;
      less.render = function (source, options, ...args) {
        audit.calls++;
        audit.resources.add(options.filename);
        return render.call(this, source, options, ...args);
      };
    }
    return less;
  };
  return audit;
}

export async function validateOutput(job, details, runInNewContext) {
  assert.deepEqual(details.assets.map(asset => asset.name).sort(), ['main.css', 'main.js']);
  const bundle = await readFile(path.join(job.output, 'main.js'), 'utf8');
  const module = { exports: {} };
  runInNewContext(bundle, { module, exports: module.exports }, { timeout: 30000 });
  assert.equal(module.exports.value, job.modules);
  const css = await readFile(path.join(job.output, 'main.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.equal(rules.length, job.modules * 3);
  const selectors = new Set();
  for (const [, rawSelector, body] of rules) {
    const selector = rawSelector.trim().replace(/\s+/g, ' ');
    assert.match(selector, /^\.bench_\d+(?::hover| > span)?$/);
    assert(!selectors.has(selector));
    selectors.add(selector);
    const expected = selector.endsWith(':hover') ? { color: '#654321', margin: '1px', padding: '0' }
      : selector.endsWith(' > span') ? { display: 'block', width: '10px', height: '10px' }
      : { color: '#123456', margin: '0', padding: '1px' };
    const declarations = body.split(';').map(s => s.trim()).filter(Boolean);
    assert.equal(declarations.length, 3);
    assert.deepEqual(Object.fromEntries(declarations.map(s => s.split(':').map(part => part.trim()))), expected);
  }
  for (let i = 0; i < job.modules; i++) for (const suffix of ['', ':hover', ' > span']) assert(selectors.has(`.bench_${i}${suffix}`));
  return { exportedValue: module.exports.value, cssRules: rules.length };
}
