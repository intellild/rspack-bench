import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createConfig, loaderCacheOptions } from './config.mjs';
import { worktreeRepository, worktreeVersion, versions, publishedVersions } from '../split-chunks-name/versions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const job = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert(versions.includes(job.version));
const req = createRequire(path.join(root, 'versions', job.version, 'package.json'));
const corePath = req.resolve('@rspack/core'), coreReq = createRequire(corePath);
const rspack = req('@rspack/core');
const packageVersion = req('@rspack/core/package.json').version;
if (job.version !== worktreeVersion) assert.equal(packageVersion, publishedVersions[job.version]);
const bindingPath = coreReq.resolve('@rspack/binding');
const binaries = Object.keys(req.cache).filter(file => file.endsWith('.node') && file.includes('rspack'));
assert.equal(binaries.length, 1);
assert.equal(coreReq('@rspack/binding/package.json').version, packageVersion);
const loaderPath = req.resolve('babel-loader'), loaderReq = createRequire(loaderPath);
const transformPath = loaderReq.resolve('babel-loader/lib/transform');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const artifacts = {};
for (const file of [corePath, bindingPath, binaries[0], path.join(path.dirname(corePath), 'worker.js')]) {
  artifacts[file] = hash(await readFile(file));
}
if (job.version === worktreeVersion) {
  assert.equal(await realpath(corePath), path.join(worktreeRepository, 'packages/rspack/dist/index.js'));
  assert.equal(await realpath(bindingPath), path.join(worktreeRepository, 'crates/node_binding/binding.js'));
  assert.equal(await realpath(path.dirname(binaries[0])), path.join(worktreeRepository, 'crates/node_binding'));
}
const dependencies = {};
for (const [name, expected] of [['babel-loader', '10.1.1'], ['@babel/core', '7.29.7']]) {
  assert.equal(loaderReq(`${name}/package.json`).version, expected);
  const entry = loaderReq.resolve(name);
  dependencies[name] = { version: expected, entry, sha256: hash(await readFile(entry)) };
}
const common = { ...job, packageVersion, compiledVersion: rspack.rspackVersion, artifacts, dependencies,
  loadedPaths: { core: corePath, binding: bindingPath, native: binaries[0], loader: loaderPath },
  environment: { node: process.version, platform: os.platform(), arch: os.arch(), release: os.release(),
    cpu: os.cpus()[0]?.model, cpus: os.cpus().length, availableParallelism: os.availableParallelism(), loadAverage: os.loadavg(),
    env: Object.fromEntries(['NODE_OPTIONS', 'RSPACK_LOADER_WORKER_THREADS', 'RAYON_NUM_THREADS', 'UV_THREADPOOL_SIZE', 'RSPACK_NUM_THREADS'].map(key => [key, process.env[key] ?? null])) } };
const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
if (job.version === 'v2-1-0' && job.cache) {
  assert(!(await readFile(corePath, 'utf8')).includes('__internal__loaderCache'));
  await json(job.resultFile, { ...common, status: 'unsupported', reason: 'Rspack 2.1.0 predates experiments.newCache and loader use.cache; no cache-on timing is reported.' });
  process.exit(0);
}
if (job.verify) {
  assert.equal(process.env.BABEL_MATRIX_LOADER, loaderPath);
  assert.equal(process.env.BABEL_MATRIX_TRANSFORM, transformPath);
}
const expectedResources = new Set(Array.from({ length: job.modules }, (_, i) => path.join(job.fixture, `module-${String(i).padStart(5, '0')}.js`)));
const now = () => process.hrtime.bigint(), ms = (a, b) => Number(b - a) / 1e6;
let marks, builtResources;
const plugin = { apply(compiler) {
  const mark = (hook, name, stage = -1e9) => hook.tap({ name: 'BenchmarkClock', stage }, () => {
    assert.equal(marks[name], undefined); marks[name] = now();
  });
  mark(compiler.hooks.make, 'make'); mark(compiler.hooks.finishMake, 'finishMake');
  mark(compiler.hooks.emit, 'emit'); mark(compiler.hooks.afterEmit, 'afterEmit', 1e9);
  compiler.hooks.thisCompilation.tap('BenchmarkClock', compilation => {
    mark(compilation.hooks.seal, 'seal'); mark(compilation.hooks.afterSeal, 'afterSeal', 1e9);
    if (job.verify) compilation.hooks.buildModule.tap('BuildAudit', module => builtResources.add(module.resource));
  });
} };
const config = createConfig(job, loaderPath, plugin);
await mkdir(job.output, { recursive: true });
const setupStart = now();
const compiler = rspack.rspack(config);
const compilerSetupMs = ms(setupStart, now());
assert.equal(compiler.options.mode, 'development');
assert.equal(compiler.options.incremental, false);
assert.equal(compiler.options.devtool, false);
assert.equal(config.module.rules[0].use[0].options.cacheDirectory, false);
if (job.version === 'v2-1-0') assert.equal(compiler.options.cache, false);
else {
  assert.equal(compiler.options.cache.type, 'memory');
  assert.deepEqual(compiler.options.experiments.newCache, loaderCacheOptions);
  assert.equal(compiler.options.module.rules[0].use[0].cache, job.cache);
}
for (const [key, value] of Object.entries(compiler.options.optimization)) {
  if (key === 'moduleIds' || key === 'chunkIds') assert.equal(value, 'natural');
  else if (key === 'minimizer') assert.deepEqual(value, []);
  else assert.equal(value, false, `Optimization enabled: ${key}`);
}
const auditOffsets = new Map();
async function readAudit() {
  if (!job.verify) return null;
  const records = [];
  for (const file of await readdir(job.auditDirectory)) {
    const lines = (await readFile(path.join(job.auditDirectory, file), 'utf8')).trim().split('\n').filter(Boolean);
    records.push(...lines.slice(auditOffsets.get(file) ?? 0).map(JSON.parse));
    auditOffsets.set(file, lines.length);
  }
  return records;
}
const builds = [], failures = [];
try {
  for (const state of ['cold', 'warm']) {
    marks = {}; builtResources = new Set();
    // Force all resources through module building, even on the second run. Content is unchanged.
    if (state === 'warm') { compiler.modifiedFiles = new Set(expectedResources); compiler.removedFiles = new Set(); }
    const start = now();
    const stats = await new Promise((resolve, reject) => compiler.run((error, value) => error ? reject(error) : resolve(value)));
    const end = now();
    const details = stats.toJson({ all: false, errors: true, warnings: true, assets: true, cachedAssets: true,
      modules: true, cachedModules: true, dependentModules: true, nestedModules: true, modulesSpace: Infinity, assetsSpace: Infinity });
    await json(path.join(job.statsDirectory, `${state}.json`), details);
    if (details.errors.length) {
      failures.push({ state, errorCount: details.errors.length, errors: details.errors.slice(0, 5), buildMs: ms(start, end) });
      break;
    }
    assert.deepEqual(details.warnings, []);
    const modules = details.modules.filter(module => module.moduleType === 'javascript/auto');
    assert.equal(modules.length, job.modules);
    assert.equal(modules.filter(module => module.built).length, job.modules, 'Every module must rebuild; module cache must stay off');
    const resources = new Set(modules.map(module => {
      const parts = module.identifier.split('!'), resource = parts.pop();
      assert.deepEqual(parts.map(item => item.split('?')[0]), [loaderPath]); return resource;
    }));
    assert.deepEqual(resources, expectedResources);
    assert.deepEqual(details.assets.map(asset => asset.name), ['main.js']);
    const source = await readFile(path.join(job.output, 'main.js'));
    const module = { exports: {} };
    runInNewContext(source.toString(), { module, exports: module.exports }, { timeout: 30000 });
    assert.equal(module.exports.value, job.modules * (job.modules - 1) / 2);
    const records = await readAudit();
    let audit = null;
    if (records) {
      assert.deepEqual(builtResources, expectedResources);
      const expectedCalls = state === 'warm' && job.cache ? 0 : job.modules;
      const counts = {};
      for (const kind of ['loader', 'transform']) {
        const calls = records.filter(record => record.kind === kind);
        assert.equal(calls.length, expectedCalls, `${state}: unexpected ${kind} call count`);
        assert.deepEqual(new Set(calls.map(call => call.resource)), expectedCalls ? expectedResources : new Set());
        for (const call of calls) assert(job.parallel ? call.threadId > 0 : call.threadId === 0, 'Wrong loader execution thread');
        counts[kind] = calls.length;
      }
      audit = { ...counts, builtModules: builtResources.size, threadIds: [...new Set(records.map(record => record.threadId))].sort((a,b) => a-b) };
    }
    const timings = { buildMs: ms(start, end), makeMs: ms(marks.make, marks.finishMake),
      finishMakeMs: ms(marks.finishMake, marks.seal), sealMs: ms(marks.seal, marks.afterSeal), emitMs: ms(marks.emit, marks.afterEmit) };
    for (const value of Object.values(timings)) assert(Number.isFinite(value) && value >= 0);
    const validation = { modules: modules.length, builtModules: modules.filter(m => m.built).length,
      audit, exportedValue: module.exports.value, outputSha256: hash(source), errors: 0, warnings: 0 };
    if (builds.length) assert.equal(validation.outputSha256, builds[0].validation.outputSha256);
    builds.push({ state, timings, validation });
  }
} finally {
  await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
}
await json(job.resultFile, { ...common, status: failures.length ? 'failed' : 'passed', compilerSetupMs, builds, failures,
  config: { ...config, plugins: ['BenchmarkClock', ...(job.verify ? ['BuildAudit'] : [])],
    module: { rules: config.module.rules.map(rule => ({ ...rule, test: String(rule.test) })) } },
  effectiveCache: compiler.options.cache, effectiveNewCache: compiler.options.experiments.newCache ?? null,
  effectiveOptimization: compiler.options.optimization });
