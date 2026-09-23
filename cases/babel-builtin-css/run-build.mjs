import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const execFileAsync = promisify(execFile);
import { createConfig } from './config.mjs';
import { worktreeRepository, worktreeVersion, versions, publishedVersions } from './versions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const job = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert(versions.includes(job.version));
const req = createRequire(path.join(root, 'versions', job.version, 'package.json'));
const corePath = req.resolve('@rspack/core'), coreReq = createRequire(corePath);
const rspack = req('@rspack/core');
const packageVersion = req('@rspack/core/package.json').version;
if (job.version !== worktreeVersion) assert.equal(packageVersion, publishedVersions[job.version]);
if (job.version !== worktreeVersion) assert.equal(rspack.rspackVersion, publishedVersions[job.version]);
const bindingPath = coreReq.resolve('@rspack/binding');
const binaries = Object.keys(req.cache).filter(file => file.endsWith('.node') && file.includes('rspack'));
assert.equal(binaries.length, 1);
assert.equal(coreReq('@rspack/binding/package.json').version, packageVersion);
const loaderPath = req.resolve('babel-loader'), loaderReq = createRequire(loaderPath);
const transformPath = loaderReq.resolve('babel-loader/lib/transform');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const artifacts = {};

const distFiles = (await readdir(path.dirname(corePath))).filter(name => name.endsWith('.js')).map(name => path.join(path.dirname(corePath), name));
for (const file of [bindingPath, binaries[0], ...distFiles]) {
  artifacts[file] = hash(await readFile(file));
}
if (job.version === worktreeVersion) {
  assert.equal(await realpath(corePath), path.join(worktreeRepository, 'packages/rspack/dist/index.js'));
  assert.equal(await realpath(bindingPath), path.join(worktreeRepository, 'crates/node_binding/binding.js'));
  assert.equal(await realpath(path.dirname(binaries[0])), path.join(worktreeRepository, 'crates/node_binding'));
}
const dependencies = {};
for (const [name, expected] of [['babel-loader', '10.1.1'], ['@babel/core', '7.29.7']]) {
  assert.equal(req(`${name}/package.json`).version, expected);
  const entry = req.resolve(name);
  dependencies[name] = { version: expected, entry, sha256: hash(await readFile(entry)) };
}
const common = { ...job, packageVersion, compiledVersion: rspack.rspackVersion, artifacts, dependencies,
  loadedPaths: { core: corePath, binding: bindingPath, native: binaries[0], loader: loaderPath },
  environment: { node: process.version, platform: os.platform(), arch: os.arch(), release: os.release(),
    cpu: os.cpus()[0]?.model, cpus: os.cpus().length, availableParallelism: os.availableParallelism(), loadAverage: os.loadavg(),
    env: Object.fromEntries(['NODE_OPTIONS', 'RSPACK_LOADER_WORKER_THREADS', 'RAYON_NUM_THREADS', 'UV_THREADPOOL_SIZE', 'RSPACK_NUM_THREADS'].map(key => [key, process.env[key] ?? null])) } };
const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
if (job.verify) {
  assert.equal(process.env.BABEL_MATRIX_LOADER, loaderPath);
  assert.equal(process.env.BABEL_MATRIX_TRANSFORM, transformPath);
}
const jsResources = new Set(Array.from({ length: job.modules }, (_, i) => path.join(job.fixture, `module-${String(i).padStart(5, '0')}.js`)));
const cssResources = new Set([...jsResources].map(resource => resource.replace(/\.js$/, '.module.css')));
const expectedResources = new Set([...jsResources, ...cssResources]);
const now = () => process.hrtime.bigint(), ms = (a, b) => Number(b - a) / 1e6;
let marks, builtResources, moduleStarts, moduleTimings;
const plugin = { apply(compiler) {
  const mark = (hook, name, stage = -1e9) => hook.tap({ name: 'BenchmarkClock', stage }, () => {
    assert.equal(marks[name], undefined); marks[name] = now();
  });
  mark(compiler.hooks.make, 'make'); mark(compiler.hooks.finishMake, 'finishMake');
  mark(compiler.hooks.emit, 'emit'); mark(compiler.hooks.afterEmit, 'afterEmit', 1e9);
  compiler.hooks.thisCompilation.tap('BenchmarkClock', compilation => {
    mark(compilation.hooks.seal, 'seal'); mark(compilation.hooks.afterSeal, 'afterSeal', 1e9);
    if (job.verify) {
      compilation.hooks.buildModule.tap('BuildAudit', module => {
        if (expectedResources.has(module.resource)) { builtResources.add(module.resource); moduleStarts.set(module.identifier(), now()); }
      });
      compilation.hooks.succeedModule.tap('BuildAudit', module => {
        const start = moduleStarts.get(module.identifier());
        if (start !== undefined) moduleTimings.push({ resource: module.resource, identifier: module.identifier(), durationMs: ms(start, now()) });
      });
    }
  });
} };
const config = createConfig(job, req, rspack, plugin);
await mkdir(job.output, { recursive: true });
const setupStart = now();
const compiler = rspack.rspack(config);
const compilerSetupMs = ms(setupStart, now());
assert.equal(compiler.options.mode, 'development');
assert.equal(compiler.options.incremental, false);
assert.equal(compiler.options.devtool, false);
assert.equal(config.module.rules[0].use[0].options.cacheDirectory, false);
assert.equal(compiler.options.cache, false);
assert.equal(compiler.options.experiments.newCache, false);
assert.equal(compiler.options.module.rules[0].use[0].cache, false);
assert.equal(compiler.options.experiments.css, true);
assert.equal(compiler.options.module.rules[1].type, 'css/module');
assert.equal(compiler.options.module.rules[1].use, undefined);
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
    if (!/^js-\d+\.jsonl$/.test(file)) continue;
    const lines = (await readFile(path.join(job.auditDirectory, file), 'utf8')).trim().split('\n').filter(Boolean);
    records.push(...lines.slice(auditOffsets.get(file) ?? 0).map(JSON.parse));
    auditOffsets.set(file, lines.length);
  }
  return records;
}
const builds = [], failures = [];
try {
  for (const state of ['cold', 'warm']) {
    marks = {}; builtResources = new Set(); moduleStarts = new Map(); moduleTimings = [];
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
    const modules = details.modules.filter(module => module.moduleType === 'javascript/auto' && jsResources.has(module.identifier.split('!').at(-1)));
    assert.equal(modules.length, job.modules);
    assert.equal(modules.filter(module => module.built).length, job.modules, 'Every JS module must rebuild');
    const resources = new Set(modules.map(module => {
      const parts = module.identifier.split('!'), resource = parts.pop();
      assert.deepEqual(parts.map(item => item.split('?')[0]), [loaderPath]); return resource;
    }));
    assert.deepEqual(resources, jsResources);
    const cssModules = details.modules.filter(module => module.moduleType === 'css/module');
    assert.equal(cssModules.length, job.modules, 'One builtin CSS module per JS');
    assert.equal(details.modules.filter(module => module.moduleType === 'css/mini-extract').length, 0);
    const cssProxies = details.modules.filter(module => module.moduleType === 'javascript/auto' && cssResources.has(module.identifier.split('!').at(-1)));
    assert.equal(cssProxies.length, 0, 'Builtin CSS must not use JS proxy modules');
    const actualCssResources = new Set(cssModules.map(module => {
      assert(module.built, 'Every builtin CSS module must rebuild');
      assert(!module.identifier.includes('!'), 'Builtin CSS must not have a loader chain');
      return module.identifier.split('|').at(-1);
    }));
    assert.deepEqual(actualCssResources, cssResources);
    assert.deepEqual(details.assets.map(asset => asset.name).sort(), ['main.cjs', 'main.css']);
    const cssOutput = await readFile(path.join(job.output, 'main.css'), 'utf8');
    const classes = [...cssOutput.matchAll(/\.scoped_bench_(\d+)\b/g)].map(match => Number(match[1]));
    assert.equal(classes.length, 3 * job.modules);
    assert.deepEqual(new Set(classes), new Set(Array.from({ length: job.modules }, (_, i) => i)));
    const cssRules = new Map([...cssOutput.matchAll(/(\.scoped_bench_\d+(?::hover|\s*>\s*span)?)\s*\{([^}]+)\}/g)]
      .map(([, selector, body]) => [selector.replace(/\s/g, ''), new Map(body.trim().split(';').filter(item => item.trim()).map(item => {
        const colon = item.indexOf(':');
        return [item.slice(0, colon).trim(), item.slice(colon + 1).replace(/\s/g, '')];
      }))]));
    assert.equal(cssRules.size, 3 * job.modules);
    for (let i = 0; i < job.modules; i++) {
      const base = cssRules.get(`.scoped_bench_${i}`);
      assert.equal(base.get('display'), 'flex');
      assert.equal(base.get('padding'), `${i % 16}px`);
      assert.equal(base.get('color'), `rgb(${i % 256},40,80)`);
      assert.equal(cssRules.get(`.scoped_bench_${i}:hover`).get('opacity'), '0.85');
      assert.equal(cssRules.get(`.scoped_bench_${i}>span`).get('font-weight'), '600');
    }
    const cssSha256 = hash(cssOutput);
    const bundleFile = path.join(job.output, 'main.cjs');
    const outputHash = createHash('sha256');
    for await (const chunk of createReadStream(bundleFile)) outputHash.update(chunk);
    const outputSha256 = outputHash.digest('hex');
    let evaluatedOutput = null;
    if (job.verify && state === 'cold') {
      const result = await execFileAsync(process.execPath, ['--max-old-space-size=24576',
        fileURLToPath(new URL('../babel-loader-large-files/evaluate-output.cjs', import.meta.url)), bundleFile,
        String(job.modules * (job.modules - 1) / 2), String(job.expectedChecksum)],
        { timeout: 300000, maxBuffer: 1024 * 1024 });
      assert.equal(result.stderr.trim(), '');
      evaluatedOutput = JSON.parse(result.stdout);
    }
    if (job.verify) await json(path.join(job.auditDirectory, `modules-${state}.json`), moduleTimings);
    const records = await readAudit();
    let audit = null;
    if (records) {
      assert.deepEqual(builtResources, expectedResources);

      const counts = {};
      for (const kind of ['loader', 'transform']) {
        const expected = jsResources;
        const expectedCalls = expected.size;
        const calls = records.filter(record => record.kind === kind);
        assert.equal(calls.length, expectedCalls, `${state}: unexpected ${kind} call count`);
        assert.deepEqual(new Set(calls.map(call => call.resource)), expected);
        for (const call of calls) assert(call.threadId > 0, 'Wrong loader execution thread');
        counts[kind] = calls.length;
      }
      audit = { ...counts, builtModules: builtResources.size, threadIds: [...new Set(records.map(record => record.threadId))].sort((a,b) => a-b) };
    }
    const timings = { buildMs: ms(start, end), makeMs: ms(marks.make, marks.finishMake),
      finishMakeMs: ms(marks.finishMake, marks.seal), sealMs: ms(marks.seal, marks.afterSeal), emitMs: ms(marks.emit, marks.afterEmit) };
    for (const value of Object.values(timings)) assert(Number.isFinite(value) && value >= 0);
    const validation = { modules: modules.length, builtModules: modules.filter(m => m.built).length,
      cssModules: cssModules.length, cssProxies: cssProxies.length, cssSha256, audit, evaluatedOutput, outputSha256, errors: 0, warnings: 0 };
    if (builds.length) { assert.equal(validation.outputSha256, builds[0].validation.outputSha256); assert.equal(cssSha256, builds[0].validation.cssSha256); }
    builds.push({ state, timings, validation });
    console.log(JSON.stringify({ event: 'build-complete', version: job.version, phase: job.phase, state, timings, validation }));
  }
} finally {
  await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
}
await json(job.resultFile, { ...common, status: failures.length ? 'failed' : 'passed', compilerSetupMs, setupAndColdBuildMs: compilerSetupMs + (builds[0]?.timings.buildMs ?? 0), builds, failures,
  config: { ...config, plugins: ['BenchmarkClock', ...(job.verify ? ['BuildAudit'] : [])],
    module: { rules: config.module.rules.map(rule => ({ ...rule, test: String(rule.test) })) } },
  effectiveCache: compiler.options.cache, effectiveNewCache: compiler.options.experiments.newCache ?? null,
  effectiveOptimization: compiler.options.optimization });
