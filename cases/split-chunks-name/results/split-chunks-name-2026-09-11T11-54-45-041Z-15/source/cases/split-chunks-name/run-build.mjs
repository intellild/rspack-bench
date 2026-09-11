import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, realpath, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { worktreeRepository, worktreeVersion, versions, publishedVersions } from './versions.mjs';
import { threadId } from 'node:worker_threads';
import { createConfig } from './config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const job = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert(versions.includes(job.version));
const req = createRequire(path.join(root, 'versions', job.version, 'package.json'));
const corePath = req.resolve('@rspack/core');
const coreReq = createRequire(corePath);
const rspack = req('@rspack/core');
const packageVersion = req('@rspack/core/package.json').version;
if (job.version !== worktreeVersion) assert.equal(packageVersion, publishedVersions[job.version]);
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
let nameCalls = 0, callbackTurns = 0, activeTurn = false;
const nameResources = new Set();
const verifyName = (module, chunks, key) => {
  nameCalls++;
  if (!activeTurn) {
    activeTurn = true;
    callbackTurns++;
    queueMicrotask(() => { activeTurn = false; });
  }
  assert.equal(threadId, 0);
  assert.equal(key, 'benchmark');
  assert(Array.isArray(chunks) && chunks.length > 0);
  assert.equal(typeof module.identifier, 'function');
  nameResources.add(module.identifier());
  return 'shared';
};
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
const config = createConfig(rspack, job, timingPlugin, verifyName);
await mkdir(job.output, { recursive: true });
if (job.mode === 'worker' && job.verify) await mkdir(path.join(job.output, 'worker-audit'));
await writeFile(path.join(job.output, 'package.json'), '{"type":"commonjs"}\n');
const setupStart = now();
const compiler = rspack.rspack(config);
const compilerSetupMs = ms(setupStart, now());
assert.equal(compiler.options.mode, 'development');
assert.equal(compiler.options.cache, false);
assert.equal(compiler.options.incremental, false);
for (const [key, value] of Object.entries(compiler.options.optimization)) {
  if (key === 'splitChunks') { assert(value && typeof value === 'object'); continue; }
  if (key === 'moduleIds' || key === 'chunkIds') assert.equal(value, 'natural');
  else if (key === 'minimizer') assert.deepEqual(value, []);
  else assert.equal(value, false, `Optimization enabled: ${key}`);
}
let stats, buildMs, buildError;
try {
  const start = now();
  stats = await new Promise((resolve, reject) => compiler.run((error, value) => {
    buildMs = ms(start, now());
    error ? reject(error) : resolve(value);
  }));
} catch (error) {
  buildError = error;
} finally {
  await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
}
if (buildError) {
  const message = buildError.stack ?? String(buildError);
  if (job.mode === 'worker' && message.includes('workerFunction must be prepared by Rspack before use')) {
    await writeFile(job.resultFile, JSON.stringify({ ...job, status: 'unsupported', error: message,
      packageVersion, compiledVersion: rspack.rspackVersion, artifacts,
      loadedPaths: { core: corePath, binding: bindingPath, nativeBinding: nativeBindings[0] } }, null, 2) + '\n');
    process.exit(0);
  }
  throw buildError;
}
const details = stats.toJson({ all: false, errors: true, warnings: true, assets: true,
  modules: true, nestedModules: true, chunks: true, chunkModules: true, dependentModules: true,
  ids: true, chunkModulesSpace: Infinity, modulesSpace: Infinity, assetsSpace: Infinity });
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
  assert.deepEqual(chain, [], 'No loaders may run');
  return resource;
}));
assert.equal(resources.size, job.modules);
for (let i = 0; i < job.modules; i++) {
  const file = path.join(job.fixture, `module-${String(i).padStart(5, '0')}.js`);
  assert(resources.has(file));
  if (job.verify && job.mode === 'callback') assert(nameResources.has(file));
}
if (job.verify && job.mode !== 'worker') {
  assert.equal(nameResources.size, job.mode === 'callback' ? job.modules : 0);
  assert(job.mode === 'callback' ? nameCalls >= job.modules : nameCalls === 0);
}
let workerAudit = null;
if (job.verify && job.mode === 'worker') {
  const directory = path.join(job.output, 'worker-audit');
  const records = [];
  for (const file of await readdir(directory)) {
    records.push(...(await readFile(path.join(directory, file), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse));
  }
  assert(records.length >= job.modules);
  assert.deepEqual(new Set(records.map(record => record.resource)), resources);
  for (const record of records) {
    assert(record.threadId > 0, 'workerFunction must execute on worker threads');
    assert.equal(record.cacheGroupKey, 'benchmark');
    assert(record.chunks > 0);
  }
  workerAudit = { calls: records.length, threadIds: [...new Set(records.map(record => record.threadId))].sort() };
}
assert.deepEqual(details.assets.map(asset => asset.name).sort(), ['main.js', 'shared.js']);
const shared = details.chunks.find(chunk => chunk.names.includes('shared'));
assert(shared, 'The named shared chunk must be emitted');
assert.equal(details.chunks.length, 2);
const sharedModules = shared.modules.filter(module => module.moduleType === 'javascript/auto');
assert.equal(sharedModules.length, job.modules);
assert.deepEqual(new Set(sharedModules.map(module => module.identifier)), resources);
const outputHashes = {};
for (const asset of details.assets) outputHashes[asset.name] = hash(await readFile(path.join(job.output, asset.name)));
const module = req(path.join(job.output, 'main.js'));
assert.equal(module.value, job.modules * (job.modules - 1) / 2);
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
  validation: { modules: modules.length, workerAudit,
    nameCalls: job.verify ? nameCalls : null, callbackTurns: job.verify ? callbackTurns : null,
    nameResources: job.verify ? nameResources.size : null,
    exportedValue: module.value, sharedModules: sharedModules.length, chunks: details.chunks.length,
    outputHashes, errors: 0, warnings: 0 },
  config: { ...config, plugins: ['BenchmarkClock'],
    module: { rules: config.module.rules.map(rule => ({ ...rule, test: rule.test.toString() })) } },
  effectiveOptimization: compiler.options.optimization,
};
await writeFile(job.resultFile, JSON.stringify(result, (_key, value) => {
  if (typeof value === 'function') return { type: 'function', source: String(value) };
  if (value instanceof RegExp) return value.toString();
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}, 2) + '\n');
