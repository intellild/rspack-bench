#!/usr/bin/env zx
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { worktreeRepository, worktreeVersion, versions } from './versions.mjs';
import { prepareFixture } from '../babel-loader/case.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const scriptIndex = process.argv.findIndex((arg, index) => index > 0 && path.resolve(arg) === script);
assert(scriptIndex > 0, 'Cannot locate benchmark script in argv');
const { values } = parseArgs({ args: process.argv.slice(scriptIndex + 1), options: {
  modules: { type: 'string', default: '10000' }, runs: { type: 'string', default: '5' },
  help: { type: 'boolean', default: false },
}, strict: true });
if (values.help) {
  console.log('pnpm bench:split-chunks-name [--modules 10000] [--runs 5]');
  process.exit(0);
}
const modules = Number(values.modules), runs = Number(values.runs);
assert(Number.isSafeInteger(modules) && modules > 0 && Number.isSafeInteger(modules * (modules - 1) / 2));
assert(Number.isSafeInteger(runs) && runs > 0);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const execFileAsync = promisify(execFile);
const lock = path.join(root, '.bench-running');
await mkdir(lock);
try {
  await json(path.join(lock, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString() });
  await main();
} finally {
  await rm(lock, { recursive: true, force: true });
}

async function main() {
  const dir = path.join(root, 'results', `split-chunks-name-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`);
  for (const name of ['fixture', 'raw', 'stats', 'jobs', 'output', 'logs']) await mkdir(path.join(dir, name), { recursive: true });
  console.log(`Results: ${dir}`);
  const prepared = await prepareFixture({ root, dir, modules });
  const { fixture, fileHashes } = prepared;
  const fixtureSha256 = hash(JSON.stringify(Object.entries(fileHashes).sort()));
  await json(path.join(dir, 'fixture.json'), { ...prepared, modules, fixtureSha256 });
  const metadata = { modules, runs, versions, startedAt: new Date().toISOString(), fixtureSha256,
    worktree: { path: worktreeRepository, head: (await execFileAsync('git', ['-C', worktreeRepository, 'rev-parse', 'HEAD'])).stdout.trim(),
      status: (await execFileAsync('git', ['-C', worktreeRepository, 'status', '--short'])).stdout.trim() },
    validationPerGroup: 1, warmupsPerGroup: 1, artifactHashes: {},
    conditions: 'Development; only splitChunks enabled; other optimizations, cache and incremental builds disabled; no loaders. Serial fresh Node processes; rotating measurement order; OS cache retained.',
    buildBoundary: 'compiler.run invocation to callback, excluding setup/close, stats, bundle execution and artifact hashing',
  };
  for (const name of ['cases/split-chunks-name/bench.mjs', 'cases/split-chunks-name/run-build.mjs',
    'cases/split-chunks-name/config.mjs', 'cases/split-chunks-name/versions.mjs', 'cases/split-chunks-name/name.cjs',
    'cases/babel-loader/case.mjs', 'cases/noop-loader/config.mjs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    ...versions.map(version => `versions/${version}/package.json`)]) {
    const source = await readFile(path.join(root, name));
    metadata.artifactHashes[name] = hash(source);
    const snapshot = path.join(dir, 'source', name);
    await mkdir(path.dirname(snapshot), { recursive: true });
    await writeFile(snapshot, source);
  }
  await json(path.join(dir, 'metadata.json'), metadata);
  const worktreePatch = (await execFileAsync('git', ['-C', worktreeRepository, 'diff', '--binary', 'HEAD'], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  await writeFile(path.join(dir, 'worktree.patch'), worktreePatch);
  metadata.worktree.patchSha256 = hash(worktreePatch);
  const groups = ['static', 'callback'].flatMap(mode => versions.map(version => ({ version, mode })));
  const workerGroup = { version: worktreeVersion, mode: 'worker' };
  let workerStatus;
  const results = [];
  async function execute(group, phase, round) {
    const id = `${group.version}-${group.mode}-${phase}-${round}`;
    const job = { ...group, id, phase, round, verify: phase === 'verify', modules, fixture, fixtureSha256,
      output: path.join(dir, 'output', id), statsFile: path.join(dir, 'stats', `${id}.json`),
      resultFile: path.join(dir, 'raw', `${id}.json`) };
    const jobFile = path.join(dir, 'jobs', `${id}.json`);
    await json(jobFile, job);
    const started = process.hrtime.bigint();
    const child = await new Promise((resolve, reject) => {
      const worker = spawn(process.execPath, [fileURLToPath(new URL('./run-build.mjs', import.meta.url)), jobFile],
        { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timeout = setTimeout(() => worker.kill('SIGKILL'), 10 * 60 * 1000);
      worker.stdout.on('data', chunk => { stdout += chunk; });
      worker.stderr.on('data', chunk => { stderr += chunk; });
      worker.once('error', error => { clearTimeout(timeout); reject(error); });
      worker.once('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, stdout, stderr }); });
    });
    const processMs = Number(process.hrtime.bigint() - started) / 1e6;
    await writeFile(path.join(dir, 'logs', `${id}.log`), child.stdout + child.stderr);
    assert.equal(child.code, 0, `${id}: ${child.signal ?? ''}\n${child.stdout}\n${child.stderr}`);
    assert.equal(child.stderr.trim(), '', child.stderr);
    const result = JSON.parse(await readFile(job.resultFile, 'utf8'));
    if (result.status === 'unsupported') return result;
    const reference = results.find(r => r.version === group.version);
    if (reference) {
      assert.deepEqual(result.artifacts, reference.artifacts, 'Rspack artifacts changed during measurement');
      assert.equal(result.compiledVersion, reference.compiledVersion);
    }
    const groupReference = results.find(r => r.version === group.version && r.mode === group.mode);
    if (groupReference) assert.deepEqual(result.validation.outputHashes, groupReference.validation.outputHashes, 'Output changed across repetitions');
    if (reference) assert.deepEqual(result.validation.outputHashes, reference.validation.outputHashes, 'Name mode changed output');
    result.timings.processMs = processMs;
    result.executionOrder = results.length;
    await json(job.resultFile, result);
    results.push(result);
    console.log(`${id}: compiled=${result.compiledVersion} build=${result.timings.buildMs.toFixed(2)}ms seal=${result.timings.sealMs.toFixed(2)}ms`);
    return result;
  }
  for (const group of groups) await execute(group, 'verify', 0);
  workerStatus = await execute(workerGroup, 'verify', 0);
  await json(path.join(dir, 'worker-function-status.json'), workerStatus);
  if (workerStatus.status === 'unsupported') console.log('workerFunction in splitChunks.name: unsupported by the loaded a77f build (see worker-function-status.json)');
  else groups.push(workerGroup);
  for (const group of groups) await execute(group, 'warmup', 0);
  for (let round = 1; round <= runs; round++) {
    const offset = (round - 1) % groups.length;
    for (const group of [...groups.slice(offset), ...groups.slice(0, offset)]) await execute(group, 'measure', round);
  }
  for (const [name, digest] of Object.entries(fileHashes)) assert.equal(hash(await readFile(path.join(fixture, name))), digest);
  const rows = groups.map(group => {
    const samples = results.filter(r => r.phase === 'measure' && r.version === group.version && r.mode === group.mode);
    assert.equal(samples.length, runs);
    return { ...group, timings: Object.fromEntries(Object.keys(samples[0].timings).map(key => [key, distribution(samples.map(r => r.timings[key]))])) };
  });
  const overheads = groups.filter(g => g.mode !== 'static').map(group => {
    const off = rows.find(r => r.version === group.version && r.mode === 'static').timings;
    const on = rows.find(r => r.version === group.version && r.mode === group.mode).timings;
    return { ...group, timings: Object.fromEntries(Object.keys(off).map(key => [key,
      { differenceMs: on[key].median - off[key].median, ratio: on[key].median / off[key].median }])) };
  });
  metadata.finishedAt = new Date().toISOString();
  metadata.fixtureUnchanged = true;
  await json(path.join(dir, 'metadata.json'), metadata);
  await json(path.join(dir, 'summary.json'), { metadata, rows, overheads, workerFunction: workerStatus });
  const fmt = n => n.toFixed(2);
  const lines = ['# splitChunks.name benchmark', '', metadata.conditions, '',
    `${modules} JS modules, extracted into one shared chunk. Static name "shared" versus a callback returning "shared". One validation, one warmup and ${runs} measured builds per supported group.`, '',
    `Worktree: ${metadata.worktree.path}. HEAD: ${metadata.worktree.head}. Status: ${metadata.worktree.status || 'clean'}. Actual compiled artifacts are identified by the recorded hashes.`, '',
    `workerFunction: ${workerStatus.status === 'unsupported' ? 'unsupported in splitChunks.name by the loaded a77f build; no worker timing is reported' : 'executed; see the worker group'}. See worker-function-status.json.`, '',
    '| Version / mode | Package / compiled | Name calls | Callback turns |', '|---|---|---:|---:|'];
  for (const r of results.filter(r => r.verify)) lines.push(`| ${r.version} / ${r.mode} | ${r.packageVersion} / ${r.compiledVersion} | ${r.validation.nameCalls} | ${r.validation.callbackTurns ?? '—'} |`);
  lines.push('', 'Times in milliseconds: median [min, max].', '',
    '| Version / mode | Build | make | finishMake | seal | emit | Process |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) lines.push(`| ${r.version} / ${r.mode} | ` + ['buildMs', 'makeMs', 'finishMakeMs', 'sealMs', 'emitMs', 'processMs'].map(key => {
    const t = r.timings[key]; return `${fmt(t.median)} [${fmt(t.min)}, ${fmt(t.max)}]`;
  }).join(' | ') + ' |');
  lines.push('', '| Version / mode | Incremental build cost | Incremental seal cost | Build / static |', '|---|---:|---:|---:|');
  for (const item of overheads) lines.push(`| ${item.version} / ${item.mode} | ${fmt(item.timings.buildMs.differenceMs)} ms | ${fmt(item.timings.sealMs.differenceMs)} ms | ${item.timings.buildMs.ratio.toFixed(3)}× |`);
  lines.push('', `Build timing: ${metadata.buildBoundary}. Seal covers seal → afterSeal and includes splitChunks, module/chunk IDs, code generation and other sealing work. It does not isolate splitChunks alone.`, '',
    'Validation counts name invocations and microtask turns, checks every callback resource and argument shape, exact loader-free module counts, shared-chunk membership, and the exported sum. Instrumentation is absent from measured callbacks. Outputs must match across naming modes and repetitions within each version. Loaded artifacts remain unchanged throughout the run.', '',
    'Differences compare whole builds and describe this synthetic graph. Samples and ranges are descriptive rather than a significance test; background machine activity and OS caches are uncontrolled.', '',
    'Raw configs, versions, environment and timings: raw/. Stats: stats/. Fixture hashes: fixture.json. Source/lock hashes: metadata.json. Source snapshot: source/. Outputs: output/. Logs: logs/.', '');
  await writeFile(path.join(dir, 'report.md'), lines.join('\n'));
  await writeFile(path.join(root, 'results', 'latest-split-chunks-name.txt'), dir + '\n');
  console.log(`Report: ${path.join(dir, 'report.md')}`);
}

function distribution(samples) {
  const sorted = [...samples].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    min: sorted[0], max: sorted.at(-1), samples };
}
