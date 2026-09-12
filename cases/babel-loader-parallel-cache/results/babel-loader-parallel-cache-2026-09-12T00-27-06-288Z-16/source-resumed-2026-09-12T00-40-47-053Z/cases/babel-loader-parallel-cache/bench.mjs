#!/usr/bin/env zx
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { prepareFixture } from '../babel-loader/case.mjs';
import { versions, worktreeRepository } from '../split-chunks-name/versions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const scriptIndex = process.argv.findIndex((arg, index) => index > 0 && path.resolve(arg) === script);
assert(scriptIndex > 0);
const { values } = parseArgs({ args: process.argv.slice(scriptIndex + 1), options: {
  modules: { type: 'string', default: '10000' }, runs: { type: 'string', default: '5' },
  help: { type: 'boolean', default: false }, resume: { type: 'string' },
}, strict: true });
if (values.help) {
  console.log('pnpm bench:babel-loader-parallel-cache [--modules 10000] [--runs 5] [--resume results/<run>]');
  process.exit(0);
}
const modules = Number(values.modules), runs = Number(values.runs);
assert(Number.isSafeInteger(modules) && modules > 0);
assert(Number.isSafeInteger(runs) && runs > 0);
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
const execFileAsync = promisify(execFile);
const lock = path.join(root, '.bench-running');
await mkdir(lock);
try {
  await json(path.join(lock, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString() });
  await main();
} finally { await rm(lock, { recursive: true, force: true }); }

async function main() {
  const dir = values.resume ? path.resolve(root, values.resume) : path.join(root, 'results', `babel-loader-parallel-cache-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`);
  for (const name of ['fixture', 'raw', 'stats', 'jobs', 'output', 'logs', 'audit', 'source']) await mkdir(path.join(dir, name), { recursive: true });
  console.log(`Results: ${dir}`);
  const fixture = values.resume ? JSON.parse(await readFile(path.join(dir, 'fixture.json'), 'utf8')) : await prepareFixture({ root, dir, modules });
  const fixtureSha256 = hash(JSON.stringify(Object.entries(fixture.fileHashes).sort()));
  await json(path.join(dir, 'fixture.json'), { ...fixture, modules, fixtureSha256 });
  const metadata = values.resume ? JSON.parse(await readFile(path.join(dir, 'metadata.json'), 'utf8')) : { modules, runs, versions, startedAt: new Date().toISOString(), fixtureSha256,
    worktree: { path: worktreeRepository,
      head: (await execFileAsync('git', ['-C', worktreeRepository, 'rev-parse', 'HEAD'])).stdout.trim(),
      status: (await execFileAsync('git', ['-C', worktreeRepository, 'status', '--short'])).stdout.trim() },
    artifactHashes: {}, validationPairsPerGroup: 1, warmupPairsPerGroup: 1,
    conditions: 'Development; all optimizations and incremental disabled. Babel disk/config caches off. Rspack 2.2.3/local use memory storage with only newCache.loader enabled; module/codeGeneration/devtool/minimize caches off. Rspack 2.1.0 legacy cache off; loader cache on unsupported. Parallel uses default worker count unless overridden in environment.',
    sequence: 'Each fresh process creates one compiler: cold build, then full rebuild with unchanged contents and all resources marked modified. Each measured pair starts with empty loader cache and a fresh worker pool. Serial processes; rotating group order; OS cache retained.',
    buildBoundary: 'compiler.run invocation to callback; setup/close, stats, audits, bundle evaluation and hashing excluded. Process timing covers the entire two-build child process.',
  };
  assert.equal(metadata.modules, modules); assert.equal(metadata.runs, runs);
  assert.equal(metadata.fixtureSha256, fixtureSha256);
  const sourceRevision = values.resume ? `source-resumed-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}` : 'source';
  const revisionHashes = {};
  const sourceFiles = ['cases/babel-loader-parallel-cache/bench.mjs', 'cases/babel-loader-parallel-cache/run-build.mjs',
    'cases/babel-loader-parallel-cache/config.mjs', 'cases/babel-loader-parallel-cache/audit-preload.cjs',
    'cases/babel-loader/case.mjs', 'cases/noop-loader/config.mjs', 'cases/split-chunks-name/versions.mjs',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', ...versions.map(version => `versions/${version}/package.json`)];
  for (const name of sourceFiles) {
    const data = await readFile(path.join(root, name)); revisionHashes[name] = hash(data);
    if (!values.resume) metadata.artifactHashes[name] = hash(data);
    else if (!['cases/babel-loader-parallel-cache/bench.mjs', 'cases/babel-loader-parallel-cache/run-build.mjs'].includes(name)) {
      assert.equal(hash(data), metadata.artifactHashes[name], `Benchmark input changed: ${name}`);
    }
    const target = path.join(dir, sourceRevision, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, data);
  }
  if (values.resume) (metadata.resumptions ??= []).push({ at: new Date().toISOString(), sourceRevision, artifactHashes: revisionHashes,
    reason: 'Continue unattempted pairs after recording the original failed attempt; no failed pair is retried. Only failure recording/resume/reporting changed.' });
  const patch = (await execFileAsync('git', ['-C', worktreeRepository, 'diff', '--binary', 'HEAD'], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  if (values.resume) assert.equal(hash(patch), metadata.worktree.patchSha256, 'Local implementation changed');
  else { await writeFile(path.join(dir, 'worktree.patch'), patch); metadata.worktree.patchSha256 = hash(patch); }
  await json(path.join(dir, 'metadata.json'), metadata);
  const groups = versions.flatMap(version => [false, true].flatMap(parallel => [false, true].map(cache => ({ version, parallel, cache }))));
  const idFor = group => `${group.version}-parallel-${group.parallel ? 'on' : 'off'}-cache-${group.cache ? 'on' : 'off'}`;
  const records = [], supported = [], unsupported = [], failures = [];
  async function execute(group, phase, round) {
    const id = `${idFor(group)}-${phase}-${round}`;
    const existingFile = path.join(dir, 'raw', `${id}.json`);
    if (values.resume) {
      let existing;
      try { existing = JSON.parse(await readFile(existingFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing) {
        if (existing.status === 'unsupported') unsupported.push(existing);
        else if (existing.status === 'failed') failures.push(existing);
        else { assert.equal(existing.status, 'passed'); records.push(existing); }
        return existing;
      }
    }
    const job = { ...group, id, phase, round, sourceRevision, verify: phase === 'verify', modules, fixture: fixture.fixture, fixtureSha256,
      output: path.join(dir, 'output', id), statsDirectory: path.join(dir, 'stats', id), auditDirectory: path.join(dir, 'audit', id), resultFile: path.join(dir, 'raw', `${id}.json`) };
    await mkdir(job.statsDirectory, { recursive: true }); await mkdir(job.auditDirectory, { recursive: true });
    const jobFile = path.join(dir, 'jobs', `${id}.json`); await json(jobFile, job);
    const env = { ...process.env };
    const args = [];
    if (job.verify) {
      const req = createRequire(path.join(root, 'versions', group.version, 'package.json'));
      const loader = req.resolve('babel-loader'), loaderReq = createRequire(loader);
      Object.assign(env, { BABEL_MATRIX_AUDIT_DIR: job.auditDirectory, BABEL_MATRIX_LOADER: loader,
        BABEL_MATRIX_TRANSFORM: loaderReq.resolve('babel-loader/lib/transform') });
      args.push('--require', fileURLToPath(new URL('./audit-preload.cjs', import.meta.url)));
    }
    args.push(fileURLToPath(new URL('./run-build.mjs', import.meta.url)), jobFile);
    const start = process.hrtime.bigint();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000);
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    });
    const processMs = Number(process.hrtime.bigint() - start) / 1e6;
    await writeFile(path.join(dir, 'logs', `${id}.log`), result.stdout + result.stderr);
    let record;
    if (result.code !== 0 || result.stderr.trim()) {
      record = { ...job, status: 'failed', exitCode: result.code, signal: result.signal,
        reason: (result.stderr || result.stdout).slice(0, 4000), logFile: path.join(dir, 'logs', `${id}.log`), processMs };
      await json(job.resultFile, record);
    } else record = JSON.parse(await readFile(job.resultFile, 'utf8'));
    if (record.status === 'failed') {
      failures.push(record); console.log(`${id}: FAILED (see raw record and log)`); return record;
    }
    if (record.status === 'unsupported') {
      unsupported.push(record); console.log(`${idFor(group)}: unsupported (${record.reason})`); return record;
    }
    assert.equal(record.status, 'passed');
    const reference = records.find(r => r.version === group.version);
    if (reference) {
      assert.deepEqual(record.artifacts, reference.artifacts, 'Loaded Rspack artifacts changed');
      assert.deepEqual(record.dependencies, reference.dependencies, 'Babel dependencies changed');
      for (const build of record.builds) assert.equal(build.validation.outputSha256, reference.builds[0].validation.outputSha256, 'Output changed between settings or repetitions');
    }
    record.processMs = processMs; record.executionOrder = records.length;
    await json(job.resultFile, record); records.push(record);
    console.log(`${id}: ${record.builds.map(b => `${b.state}=${b.timings.buildMs.toFixed(2)}ms`).join(' ')}${job.verify ? ' audit=' + JSON.stringify(record.builds.map(b => b.validation.audit)) : ''}`);
    return record;
  }
  for (const group of groups) if ((await execute(group, 'verify', 0)).status === 'passed') supported.push(group);
  await json(path.join(dir, 'unsupported.json'), unsupported);
  for (const group of supported) await execute(group, 'warmup', 0);
  for (let round = 1; round <= runs; round++) {
    const offset = (round - 1) % supported.length;
    for (const group of [...supported.slice(offset), ...supported.slice(0, offset)]) await execute(group, 'measure', round);
  }
  for (const [name, digest] of Object.entries(fixture.fileHashes)) assert.equal(hash(await readFile(path.join(fixture.fixture, name))), digest);
  const rows = supported.map(group => {
    const samples = records.filter(r => r.phase === 'measure' && idFor(r) === idFor(group));
    const states = {};
    for (const state of ['cold', 'warm']) {
      states[state] = Object.fromEntries(['buildMs', 'makeMs', 'finishMakeMs', 'sealMs', 'emitMs'].map(key =>
        [key, distribution(samples.map(r => r.builds.find(b => b.state === state).timings[key]))]));
    }
    return { ...group, states, successfulSamples: samples.length, failedSamples: failures.filter(r => r.phase === 'measure' && idFor(r) === idFor(group)).length, processMs: distribution(samples.map(r => r.processMs)),
      compilerSetupMs: distribution(samples.map(r => r.compilerSetupMs)) };
  });
  metadata.finishedAt = new Date().toISOString(); metadata.fixtureUnchanged = true;
  metadata.supportedGroups = supported.length; metadata.unsupportedGroups = unsupported.length; metadata.successfulBuilds = records.length * 2;
  metadata.failedPairs = failures.length;
  metadata.attemptedPairs = records.length + failures.length;
  await json(path.join(dir, 'failures.json'), failures);
  await json(path.join(dir, 'metadata.json'), metadata);
  await json(path.join(dir, 'summary.json'), { metadata, rows, failures, unsupported: unsupported.map(({version, parallel, cache, reason}) => ({version, parallel, cache, reason})) });
  const fmt = d => d.median === null ? 'no successful samples' : `${d.median.toFixed(2)} [${d.min.toFixed(2)}, ${d.max.toFixed(2)}]`;
  const lines = ['# Babel loader parallel / cache benchmark', '', metadata.conditions, '', metadata.sequence, '',
    `${modules} modules; one validation pair, one warmup pair and ${runs} measured pairs per supported group. ${metadata.successfulBuilds} builds in successful pairs; ${failures.length} failed pairs (not retried).`, '',
    'Milliseconds: median [min, max]. Cold starts with an empty loader cache. Warm rebuilds all modules and reuses the compiler, loader cache and worker pool.', '',
    '| Version | parallel | use.cache | Cold build | Warm build | Cold make | Warm make | Pair process | Successful / attempted samples |', '|---|---|---|---:|---:|---:|---:|---:|---:|'];
  for (const group of groups) {
    const row = rows.find(r => idFor(r) === idFor(group));
    lines.push(`| ${group.version} | ${group.parallel ? 'on' : 'off'} | ${group.cache ? 'on' : 'off'} | ${row ? [row.states.cold.buildMs, row.states.warm.buildMs, row.states.cold.makeMs, row.states.warm.makeMs, row.processMs].map(fmt).join(' | ') : 'unsupported | unsupported | — | — | —'} | ${row ? `${row.successfulSamples} / ${runs}` : '—'} |`);
  }
  if (failures.length) {
    lines.push('', 'Failed pairs are excluded from timing distributions and retained in failures.json/raw records. No automatic retries were performed. Successful-sample medians are conditional on completion; consult failure counts alongside timings.', '');
    for (const failure of failures) lines.push(`- ${failure.id}: ${failure.failures?.[0]?.errors?.[0]?.message ?? failure.reason ?? 'See failure record'}`);
  }
  lines.push('', '| Validation group | Cold Babel calls | Warm Babel calls | Cold / warm rebuilt modules | Worker threads observed |', '|---|---:|---:|---:|---|');
  for (const r of records.filter(r => r.verify)) lines.push(`| ${idFor(r)} | ${r.builds[0].validation.audit.transform} | ${r.builds[1].validation.audit.transform} | ${r.builds.map(b => b.validation.builtModules).join(' / ')} | ${r.builds[0].validation.audit.threadIds.join(', ')} |`);
  lines.push('', `Timing: ${metadata.buildBoundary}`, '',
    'Only validation processes preload invocation counters. Measured builds contain no loader/Babel counters or buildModule taps. All builds check 10,000 freshly built modules, the exact Babel loader chain, output hashes and the exported sum. Outputs match across settings and repetitions within each version. Loader cache hits are confirmed by zero loader and Babel calls on the warm validation build while all modules still rebuild.', '',
    'The memory backend is required by the new loader cache; it does not enable the disabled module, code-generation, devtool or minimizer layers. Rspack 2.1.0 has neither experiments.newCache nor use.cache, so its cache-on combinations have no timings. Babel cacheDirectory, babelrc and configFile are false in every group.', '',
    'Each cache-on/off comparison within 2.2.3 or local changes only use.cache. The 2.1.0 cache-off groups use cache:false because that version has only the legacy cache. Default worker counts and fresh pool startup are included as described above. Repeated rebuilds also benefit from worker/JIT/OS warmup, so cold-to-warm differences alone do not isolate cache savings: compare cache on versus off within the same state and parallel setting.', '',
    'Raw records: raw/. Full stats: stats/. Validation invocation logs: audit/. Source snapshots: source/. Worktree patch: worktree.patch. Fixture hashes: fixture.json. Timings are descriptive, not significance tests; background activity and OS cache state are uncontrolled.', '');
  await writeFile(path.join(dir, 'report.md'), lines.join('\n'));
  await writeFile(path.join(root, 'results/latest-babel-loader-parallel-cache.txt'), dir + '\n');
  console.log(`Report: ${path.join(dir, 'report.md')}`);
  if (failures.length) process.exitCode = 1;
}

function distribution(values) {
  if (!values.length) return { median: null, min: null, max: null, samples: [] };
  const sorted = [...values].sort((a,b) => a-b), mid = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid])/2, min: sorted[0], max: sorted.at(-1), samples: values };
}
