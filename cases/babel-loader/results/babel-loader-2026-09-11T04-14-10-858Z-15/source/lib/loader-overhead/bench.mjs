#!/usr/bin/env zx
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { worktreeRepository, worktreeVersion } from '../../cases/noop-loader/versions.mjs';

export async function runBenchmark(caseName, scriptUrl) {
const root = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(scriptUrl);
const definition = await import(new URL(`../../cases/${caseName}/case.mjs`, import.meta.url));
const scriptIndex = process.argv.findIndex((arg, index) => index > 0 && path.resolve(arg) === script);
assert(scriptIndex > 0, 'Cannot locate benchmark script in argv');
const { values } = parseArgs({ args: process.argv.slice(scriptIndex + 1), options: {
  modules: { type: 'string', default: '10000' }, runs: { type: 'string', default: '5' },
  help: { type: 'boolean', default: false },
}, strict: true });
if (values.help) {
  console.log(`pnpm bench:${caseName} [--modules 10000] [--runs 5]`);
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
  const dir = path.join(root, 'results', `${caseName}-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`);
  for (const name of ['fixture', 'raw', 'stats', 'jobs', 'output', 'logs']) await mkdir(path.join(dir, name), { recursive: true });
  console.log(`Results: ${dir}`);
  const prepared = await definition.prepareFixture({ root, dir, modules });
  const { fixture, fileHashes } = prepared;
  const fixtureSha256 = hash(JSON.stringify(Object.entries(fileHashes).sort()));
  await json(path.join(dir, 'fixture.json'), { ...prepared, modules, fixtureSha256 });
  const metadata = { caseName, modules, runs, versions: ['v2', worktreeVersion], startedAt: new Date().toISOString(), fixtureSha256,
    worktree: { path: worktreeRepository, head: (await execFileAsync('git', ['-C', worktreeRepository, 'rev-parse', 'HEAD'])).stdout.trim(),
      status: (await execFileAsync('git', ['-C', worktreeRepository, 'status', '--short'])).stdout.trim() },
    validationPerGroup: 1, warmupsPerGroup: 1, artifactHashes: {},
    conditions: 'Development; all optimization flags disabled; no cache/incremental; serial loaders; no NormalModule loader hook taps. Serial fresh Node processes; rotating measurement order; OS cache retained.',
    workload: definition.description,
    buildBoundary: 'compiler.run invocation to callback, excluding setup/close, stats, bundle execution and artifact hashing',
  };
  for (const name of ['lib/loader-overhead/bench.mjs', 'lib/loader-overhead/run-build.mjs',
    `cases/${caseName}/bench.mjs`, `cases/${caseName}/case.mjs`, 'cases/noop-loader/config.mjs', 'cases/noop-loader/versions.mjs',
    'versions.mjs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'versions/v2/package.json', 'versions/worktree-0385/package.json']) {
    const source = await readFile(path.join(root, name));
    metadata.artifactHashes[name] = hash(source);
    const snapshot = path.join(dir, 'source', name);
    await mkdir(path.dirname(snapshot), { recursive: true });
    await writeFile(snapshot, source);
  }
  await json(path.join(dir, 'metadata.json'), metadata);
  const groups = [false, true].flatMap(loaded => ['v2', worktreeVersion].map(version => ({ version, loaded })));
  const results = [];
  async function execute(group, phase, round) {
    const id = `${group.version}-${group.loaded ? 'loader' : 'baseline'}-${phase}-${round}`;
    const job = { ...group, caseName, id, phase, round, verify: phase === 'verify', modules, fixture, fixtureSha256,
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
    const reference = results.find(r => r.version === group.version);
    if (reference) {
      assert.deepEqual(result.artifacts, reference.artifacts, 'Rspack artifacts changed during measurement');
      assert.equal(result.compiledVersion, reference.compiledVersion);
      assert.deepEqual(result.dependencies, reference.dependencies, 'Loader dependencies changed during measurement');
    }
    const groupReference = results.find(r => r.version === group.version && r.loaded === group.loaded);
    if (groupReference) assert.deepEqual(result.validation.outputHashes, groupReference.validation.outputHashes, 'Output changed across repetitions');
    const otherVersion = results.find(r => r.version !== group.version && r.loaded === group.loaded);
    if (otherVersion) assert.deepEqual(result.validation.outputHashes, otherVersion.validation.outputHashes, 'Versions emitted different outputs');
    if (definition.compareCss && reference) assert.equal(result.validation.outputHashes['main.css'], reference.validation.outputHashes['main.css'], 'Less output differs from precompiled CSS');
    result.timings.processMs = processMs;
    result.executionOrder = results.length;
    await json(job.resultFile, result);
    results.push(result);
    console.log(`${id}: compiled=${result.compiledVersion} build=${result.timings.buildMs.toFixed(2)}ms make=${result.timings.makeMs.toFixed(2)}ms`);
  }
  for (const phase of ['verify', 'warmup']) for (const group of groups) await execute(group, phase, 0);
  for (let round = 1; round <= runs; round++) {
    const offset = (round - 1) % groups.length;
    for (const group of [...groups.slice(offset), ...groups.slice(0, offset)]) await execute(group, 'measure', round);
  }
  for (const [name, digest] of Object.entries(fileHashes)) assert.equal(hash(await readFile(path.join(fixture, name))), digest);
  const rows = groups.map(group => {
    const samples = results.filter(r => r.phase === 'measure' && r.version === group.version && r.loaded === group.loaded);
    assert.equal(samples.length, runs);
    return { ...group, timings: Object.fromEntries(Object.keys(samples[0].timings).map(key => [key, distribution(samples.map(r => r.timings[key]))])) };
  });
  const overheads = Object.fromEntries(['v2', worktreeVersion].map(version => {
    const off = rows.find(r => r.version === version && !r.loaded).timings;
    const on = rows.find(r => r.version === version && r.loaded).timings;
    return [version, Object.fromEntries(Object.keys(off).map(key => [key, { differenceMs: on[key].median - off[key].median, ratio: on[key].median / off[key].median }]))];
  }));
  const comparisons = [false, true].map(loaded => ({ loaded, localOverPublished:
    rows.find(r => r.version === worktreeVersion && r.loaded === loaded).timings.buildMs.median /
    rows.find(r => r.version === 'v2' && r.loaded === loaded).timings.buildMs.median }));
  const overheadDifferenceMs = overheads[worktreeVersion].buildMs.differenceMs - overheads.v2.buildMs.differenceMs;
  metadata.finishedAt = new Date().toISOString();
  metadata.fixtureUnchanged = true;
  await json(path.join(dir, 'metadata.json'), metadata);
  await json(path.join(dir, 'summary.json'), { metadata, rows, overheads, comparisons, overheadDifferenceMs });
  const fmt = n => n.toFixed(2);
  const lines = [`# ${caseName} overhead benchmark`, '', metadata.conditions, '', metadata.workload, '',
    `${modules} workload modules. Four groups: 2.2.3/worktree-0385 × baseline/loader. One validation, one warmup and ${runs} measured builds per group.`, '',
    `Worktree: ${metadata.worktree.path}. HEAD: ${metadata.worktree.head}. Status: ${metadata.worktree.status || 'clean'}. Actual compiled artifacts are identified by hashes in raw/.`, '',
    '| Group | Package / compiled core | Loader calls | Compiler calls |', '|---|---|---:|---:|'];
  for (const r of results.filter(r => r.verify)) lines.push(`| ${r.version}, ${r.loaded ? 'loader' : 'baseline'} | ${r.packageVersion} / ${r.compiledVersion} | ${r.validation.loaderCalls} | ${r.validation.compilerCalls} |`);
  lines.push('', 'Times in milliseconds: median [min, max].', '',
    '| Group | Build | make | finishMake | seal | emit | Process |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) lines.push(`| ${r.version}, ${r.loaded ? 'loader' : 'baseline'} | ` + ['buildMs', 'makeMs', 'finishMakeMs', 'sealMs', 'emitMs', 'processMs'].map(key => {
    const t = r.timings[key]; return `${fmt(t.median)} [${fmt(t.min)}, ${fmt(t.max)}]`;
  }).join(' | ') + ' |');
  lines.push('', '| Version | Loader overhead (loader − baseline) | Loader / baseline | Amortized overhead per module |', '|---|---:|---:|---:|');
  for (const [version, item] of Object.entries(overheads)) lines.push(`| ${version} | ${fmt(item.buildMs.differenceMs)} ms | ${item.buildMs.ratio.toFixed(3)}× | ${fmt(item.buildMs.differenceMs * 1000 / modules)} µs |`);
  lines.push('', `Difference of loader overheads (worktree − 2.2.3): ${fmt(overheadDifferenceMs)} ms.`, '');
  for (const c of comparisons) lines.push(`- ${c.loaded ? 'Loader' : 'Baseline'}: worktree / 2.2.3 = ${c.localOverPublished.toFixed(3)}×.`);
  lines.push('', `Build timing: ${metadata.buildBoundary}. make: make → finishMake; finishMake: finishMake → seal; seal: seal → afterSeal; emit: emit → afterEmit. Process includes all worker work.`, '',
    'Validation checks module counts, exact loader chains, compiler invocations, every resource, and emitted output. Instrumentation is absent from measured builds. Output hashes match across repetitions and versions for each pipeline; Less output also matches the CSS baseline. Core/native and loader dependency hashes remain unchanged between builds.', '',
    'Overhead is the difference between median whole-build times. It includes compiler work, loader resolution, and Rust/JS scheduling; it does not isolate bridge overhead or prove a single source change caused a difference. Per-module figures amortize the total rather than time individual calls. Samples and ranges are descriptive, with uncontrolled machine activity.', '',
    'Raw configs, dependency versions, environment and timings: raw/. Stats: stats/. Fixture hashes: fixture.json. Source/lock hashes: metadata.json. Exact source snapshot: source/. Outputs: output/. Logs: logs/.', '');
  await writeFile(path.join(dir, 'report.md'), lines.join('\n'));
  await writeFile(path.join(root, 'results', `latest-${caseName}.txt`), dir + '\n');
  console.log(`Report: ${path.join(dir, 'report.md')}`);
}

function distribution(samples) {
  const sorted = [...samples].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    min: sorted[0], max: sorted.at(-1), samples };
}

}
