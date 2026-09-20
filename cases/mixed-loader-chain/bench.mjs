#!/usr/bin/env zx
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { modes, loaderPaths } from './config.mjs';
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
  console.log('pnpm bench:mixed-loader-chain [--modules 10000] [--runs 5] [--resume results/<run>]');
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
  const dir = values.resume ? path.resolve(root, values.resume) : path.join(root, 'results', `mixed-loader-chain-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`);
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
    conditions: 'Development; all optimizations, all caches and incremental builds disabled. Three synchronous noop JS loaders. main=[false,false,false], mixed=[false,true,false], parallel=[true,true,true] in configured use order; normal execution runs right to left. Default worker count unless overridden in environment.',
    sequence: 'Each fresh process creates one compiler: cold build, then full rebuild with unchanged contents and all resources marked modified. Each measured pair starts in a fresh process. The full rebuild reuses the compiler and any workers; all three loaders must run again on every module. Serial processes; rotating group order; OS cache retained.',
    buildBoundary: 'compiler.run invocation to callback; setup/close, stats, audits, bundle evaluation and hashing excluded. Process timing covers the entire two-build child process.',
  };
  assert.equal(metadata.modules, modules); assert.equal(metadata.runs, runs);
  assert.equal(metadata.fixtureSha256, fixtureSha256);
  const sourceRevision = values.resume ? `source-resumed-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}` : 'source';
  const revisionHashes = {};
  const sourceFiles = ['cases/mixed-loader-chain/bench.mjs', 'cases/mixed-loader-chain/run-build.mjs',
    'cases/mixed-loader-chain/config.mjs', 'cases/mixed-loader-chain/audit-preload.cjs',
    ...['left', 'middle', 'right'].map(name => `cases/mixed-loader-chain/loaders/${name}.cjs`),
    'cases/babel-loader/case.mjs', 'cases/noop-loader/config.mjs', 'cases/split-chunks-name/versions.mjs',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', ...versions.map(version => `versions/${version}/package.json`)];
  for (const name of sourceFiles) {
    const data = await readFile(path.join(root, name)); revisionHashes[name] = hash(data);
    if (!values.resume) metadata.artifactHashes[name] = hash(data);
    else if (!['cases/mixed-loader-chain/bench.mjs', 'cases/mixed-loader-chain/run-build.mjs'].includes(name)) {
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
  const groups = versions.flatMap(version => Object.keys(modes).map(mode => ({ version, mode })));
  const idFor = group => `${group.version}-${group.mode}`;
  const records = [], supported = [], failures = [];
  async function execute(group, phase, round) {
    const id = `${idFor(group)}-${phase}-${round}`;
    const existingFile = path.join(dir, 'raw', `${id}.json`);
    if (values.resume) {
      let existing;
      try { existing = JSON.parse(await readFile(existingFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing) {
        if (existing.status === 'failed') failures.push(existing);
        else { assert.equal(existing.status, 'passed'); records.push(existing); }
        return existing;
      }
      // A job file without a result may be a failed/interrupted attempt, not fresh work.
      try {
        await readFile(path.join(dir, 'jobs', `${id}.json`));
        throw new Error(`Attempt ${id} has no result. Preserve its failure/interruption record before resuming; it will not be retried automatically.`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const job = { ...group, id, phase, round, sourceRevision, verify: phase === 'verify', modules, fixture: fixture.fixture, fixtureSha256,
      output: path.join(dir, 'output', id), statsDirectory: path.join(dir, 'stats', id), auditDirectory: path.join(dir, 'audit', id), resultFile: path.join(dir, 'raw', `${id}.json`) };
    await mkdir(job.statsDirectory, { recursive: true }); await mkdir(job.auditDirectory, { recursive: true });
    const jobFile = path.join(dir, 'jobs', `${id}.json`); await json(jobFile, job);
    const env = { ...process.env };
    const args = [];
    if (job.verify) {
      Object.assign(env, { MIXED_CHAIN_AUDIT_DIR: job.auditDirectory, MIXED_CHAIN_LOADERS: JSON.stringify(loaderPaths) });
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
    assert.equal(record.status, 'passed');
    const reference = records.find(r => r.version === group.version);
    if (reference) {
      assert.deepEqual(record.artifacts, reference.artifacts, 'Loaded Rspack artifacts changed');
      assert.deepEqual(record.loaders, reference.loaders, 'Loader sources changed');
      for (const build of record.builds) assert.equal(build.validation.outputSha256, reference.builds[0].validation.outputSha256, 'Output changed between settings or repetitions');
    }
    record.processMs = processMs; record.executionOrder = records.length;
    await json(job.resultFile, record); records.push(record);
    console.log(`${id}: ${record.builds.map(b => `${b.state}=${b.timings.buildMs.toFixed(2)}ms`).join(' ')}${job.verify ? ' audit=' + JSON.stringify(record.builds.map(b => b.validation.audit)) : ''}`);
    return record;
  }
  for (const group of groups) if ((await execute(group, 'verify', 0)).status === 'passed') supported.push(group);
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
  metadata.supportedGroups = supported.length; metadata.successfulBuilds = records.length * 2;
  metadata.failedPairs = failures.length;
  metadata.attemptedPairs = records.length + failures.length;
  await json(path.join(dir, 'failures.json'), failures);
  await json(path.join(dir, 'metadata.json'), metadata);
  const comparisons = rows.filter(row => row.mode !== 'main').map(row => {
    const baseline = rows.find(other => other.version === row.version && other.mode === 'main');
    return { version: row.version, mode: row.mode, states: Object.fromEntries(['cold', 'warm'].map(state => {
      const current = row.states[state].buildMs.median, main = baseline?.states[state].buildMs.median;
      return [state, { differenceMs: current == null || main == null ? null : current - main,
        ratio: current == null || main == null ? null : current / main }];
    })) };
  });
  await json(path.join(dir, 'summary.json'), { metadata, rows, comparisons, failures });
  const fmt = d => d.median === null ? 'no successful samples' : `${d.median.toFixed(2)} [${d.min.toFixed(2)}, ${d.max.toFixed(2)}]`;
  const lines = ['# Mixed JS loader chain benchmark', '', metadata.conditions, '', metadata.sequence, '',
    `${modules} modules; one validation pair, one warmup pair and ${runs} measured attempts per validated group. ${metadata.successfulBuilds} builds in successful pairs; ${failures.length} failed pairs, never automatically retried.`, '',
    'Milliseconds: median [min, max]. The warm state is a full rebuild with every resource marked modified and all caching disabled.', '',
    '| Version | Mode | Cold build | Full rebuild | Cold make | Warm make | Pair process | Successful / attempted measured pairs |',
    '|---|---|---:|---:|---:|---:|---:|---:|'];
  for (const group of groups) {
    const row = rows.find(r => idFor(r) === idFor(group));
    lines.push(`| ${group.version} | ${group.mode} | ${row ? [row.states.cold.buildMs, row.states.warm.buildMs, row.states.cold.makeMs, row.states.warm.makeMs, row.processMs].map(fmt).join(' | ') : 'validation failed | — | — | — | —'} | ${row ? `${row.successfulSamples} / ${runs}` : '—'} |`);
  }
  lines.push('', '| Version / mode | Cold build delta vs main | Full rebuild delta vs main |', '|---|---:|---:|');
  for (const item of comparisons) lines.push(`| ${item.version} / ${item.mode} | ` + ['cold','warm'].map(state => {
    const value = item.states[state];
    return value.differenceMs == null ? 'no successful samples' : `${value.differenceMs.toFixed(2)} ms (${value.ratio.toFixed(3)}×)`;
  }).join(' | ') + ' |');
  if (failures.length) {
    lines.push('', 'Failed pairs are retained and excluded from timing distributions. Consult failure counts alongside successful-sample medians.', '');
    for (const failure of failures) lines.push(`- ${failure.id}: ${(failure.failures?.[0]?.errors?.[0]?.message ?? failure.reason ?? 'See raw record').trimEnd()}`);
  }
  lines.push('', '| Validation group | Cold calls per loader | Warm calls per loader | Resources with correct order (cold / warm) |', '|---|---|---|---|');
  for (const r of records.filter(r => r.verify)) lines.push(`| ${idFor(r)} | ${r.builds[0].validation.audit.calls.join(' / ')} | ${r.builds[1].validation.audit.calls.join(' / ')} | ${r.builds.map(b => b.validation.audit.orderedResources).join(' / ')} |`);
  lines.push('', `Timing: ${metadata.buildBoundary}`, '',
    'Validation-only preload counters verify exactly 10,000 invocations of each of three independent loader files, every resource, right-to-left execution order, and main/worker thread placement on both builds. Measured builds contain no invocation counters or buildModule taps. All builds validate freshly built module counts, the three-loader chain, output hashes and exported sum. Outputs match across modes and repetitions within each version.', '',
    'Local a77f prewarms its pool when Rspack loads and waits before native worker builds. Artifact hashing and setup are outside build timing and may overlap startup; process timing includes the entire pair, loading, validation, stats compression, and shutdown. No claim is made that build-time deltas equal end-to-end savings. Warm rebuilds reuse workers and runtime state, but no module or loader results.', '',
    'Noops measure orchestration and thread-transition cost, not useful transform throughput. Ordinary filesystem/OS/runtime caches are not flushed. Samples and ranges are descriptive; background activity is uncontrolled.', '',
    'Raw records: raw/. Compressed stats: stats/. Validation invocation logs: audit/. Source snapshots: source/. Worktree patch: worktree.patch. Fixture hashes: fixture.json.', '');
  await writeFile(path.join(dir, 'report.md'), lines.join('\n'));
  await writeFile(path.join(root, 'results/latest-mixed-loader-chain.txt'), dir + '\n');
  console.log(`Report: ${path.join(dir, 'report.md')}`);
  if (failures.length) process.exitCode = 1;
}

function distribution(values) {
  if (!values.length) return { median: null, min: null, max: null, samples: [] };
  const sorted = [...values].sort((a,b) => a-b), mid = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid])/2, min: sorted[0], max: sorted.at(-1), samples: values };
}
