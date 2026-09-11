import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { validateCore } from '../../versions.mjs';
import { worktreeRepository, worktreeVersion } from './versions.mjs';
import { createConfig, noopPath } from './config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const job = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert(['v2', worktreeVersion].includes(job.version));
const req = createRequire(path.join(root, 'versions', job.version, 'package.json'));
const corePath = req.resolve('@rspack/core');
const coreReq = createRequire(corePath);
const rspack = req('@rspack/core');
const packageVersion = job.version === 'v2' ? validateCore(job.version, req) : req('@rspack/core/package.json').version;
const bindingPath = coreReq.resolve('@rspack/binding');
const nativeBindings = Object.keys(req.cache).filter(file => file.endsWith('.node') && file.includes('rspack'));
assert.equal(nativeBindings.length, 1);
assert.equal(coreReq('@rspack/binding/package.json').version, packageVersion);
const nativeManifest = JSON.parse(await readFile(path.join(path.dirname(nativeBindings[0]), 'package.json'), 'utf8'));
assert.equal(nativeManifest.version, packageVersion);
if (job.version === worktreeVersion) {
  assert.equal(await realpath(corePath), await realpath(path.join(worktreeRepository, 'packages/rspack/dist/index.js')));
  assert.equal(await realpath(bindingPath), path.join(worktreeRepository, 'crates/node_binding/binding.js'));
  assert.equal(await realpath(path.dirname(nativeBindings[0])), path.join(worktreeRepository, 'crates/node_binding'));
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const artifacts = {};
for (const file of [corePath, bindingPath, nativeBindings[0]]) artifacts[file] = hash(await readFile(file));
let noopCalls = 0;
const noopResources = new Set();
if (job.verify) {
  const original = req(noopPath);
  req.cache[noopPath].exports = function (source) {
    noopCalls++;
    noopResources.add(this.resourcePath);
    return original.call(this, source);
  };
}
const now = () => process.hrtime.bigint();
const ms = (a, b) => Number(b - a) / 1e6;
const marks = {};
const timingPlugin = { apply(compiler) {
  const mark = (hook, name, stage = -1e9) => hook.tap({ name: 'BenchmarkClock', stage }, () => {
    assert.equal(marks[name], undefined);
    marks[name] = now();
  });
  mark(compiler.hooks.make, 'make');
  mark(compiler.hooks.finishMake, 'finishMake');
  mark(compiler.hooks.emit, 'emit');
  mark(compiler.hooks.afterEmit, 'afterEmit', 1e9);
  compiler.hooks.thisCompilation.tap('BenchmarkClock', compilation => {
    mark(compilation.hooks.seal, 'seal');
    mark(compilation.hooks.afterSeal, 'afterSeal', 1e9);
  });
} };
const config = createConfig(rspack, job, timingPlugin);
const setupStart = now();
const compiler = rspack.rspack(config);
const compilerSetupMs = ms(setupStart, now());
assert.equal(compiler.options.mode, 'development');
assert.equal(compiler.options.cache, false);
assert.equal(compiler.options.incremental, false);
for (const [key, value] of Object.entries(compiler.options.optimization)) {
  if (key === 'moduleIds' || key === 'chunkIds') assert.equal(value, 'natural');
  else if (key === 'minimizer') assert.deepEqual(value, []);
  else assert.equal(value, false, `Optimization enabled: ${key}`);
}
let stats, buildMs;
try {
  const start = now();
  stats = await new Promise((resolve, reject) => compiler.run((error, value) => {
    buildMs = ms(start, now());
    error ? reject(error) : resolve(value);
  }));
} finally {
  await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
}
const details = stats.toJson({ all: false, errors: true, warnings: true, assets: true,
  modules: true, nestedModules: true, modulesSpace: Infinity, assetsSpace: Infinity });
await writeFile(job.statsFile, JSON.stringify(details, null, 2));
assert.deepEqual(details.errors, []);
assert.deepEqual(details.warnings, []);
const flattened = [];
function visit(modules = []) {
  for (const module of modules) { flattened.push(module); visit(module.modules); }
}
visit(details.modules);
const modules = flattened.filter(module => module.moduleType === 'javascript/auto');
assert.equal(modules.length, job.modules);
const resources = new Set(modules.map(module => {
  const chain = module.identifier.split('!');
  const resource = chain.pop();
  assert.deepEqual(chain, job.noop ? [noopPath] : [], 'Unexpected loader chain');
  return resource;
}));
assert.equal(resources.size, job.modules);
for (let i = 0; i < job.modules; i++) {
  const file = path.join(job.fixture, `module-${String(i).padStart(5, '0')}.js`);
  assert(resources.has(file));
  if (job.verify && job.noop) assert(noopResources.has(file));
}
if (job.verify) {
  assert.equal(noopCalls, job.noop ? job.modules : 0);
  assert.equal(noopResources.size, job.noop ? job.modules : 0);
}
assert.deepEqual(details.assets.map(asset => asset.name), ['main.js']);
const bundle = await readFile(path.join(job.output, 'main.js'));
const module = { exports: {} };
runInNewContext(bundle.toString(), { module, exports: module.exports }, { timeout: 30000 });
assert.equal(module.exports.value, job.modules * (job.modules - 1) / 2);
const timings = { buildMs, compilerSetupMs,
  makeMs: ms(marks.make, marks.finishMake), finishMakeMs: ms(marks.finishMake, marks.seal),
  sealMs: ms(marks.seal, marks.afterSeal), emitMs: ms(marks.emit, marks.afterEmit) };
for (const key of ['makeMs', 'finishMakeMs', 'sealMs', 'emitMs']) assert(timings[key] >= 0 && timings[key] <= buildMs);
const result = { ...job, timings, packageVersion, compiledVersion: rspack.rspackVersion,
  loadedPaths: { core: corePath, binding: bindingPath, nativeBinding: nativeBindings[0] }, artifacts,
  environment: { node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(),
    cpu: os.cpus()[0]?.model, availableParallelism: os.availableParallelism(), loadAverage: os.loadavg(),
    env: Object.fromEntries(['NODE_OPTIONS', 'RAYON_NUM_THREADS', 'UV_THREADPOOL_SIZE', 'RSPACK_NUM_THREADS',
      'RSPACK_LOADER_WORKER_THREADS'].map(key => [key, process.env[key] ?? null])) },
  validation: { modules: modules.length, noopCalls: job.verify ? noopCalls : null,
    exportedValue: module.exports.value,
    bundleSha256: hash(bundle), errors: 0, warnings: 0 },
  config: { ...config, plugins: ['BenchmarkClock'],
    module: { rules: config.module.rules.map(rule => ({ ...rule, test: rule.test.toString() })) } },
  effectiveOptimization: compiler.options.optimization,
};
await writeFile(job.resultFile, JSON.stringify(result, null, 2) + '\n');
