#!/usr/bin/env zx
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { prepareFixture } from './fixture.mjs';
import { versions, worktreeRepository, worktreeVersion } from './versions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const scriptIndex = process.argv.findIndex((arg, index) => index > 0 && path.resolve(arg) === script);
assert(scriptIndex > 0);
const { values } = parseArgs({ args: process.argv.slice(scriptIndex + 1), options: {
  modules: { type: 'string', default: '10000' }, lines: { type: 'string', default: '1200' },
  runs: { type: 'string', default: '5' }, workers: { type: 'string', default: '8' },
  'diagnostic-only': { type: 'boolean', default: false }, help: { type: 'boolean', default: false }, 'generate-only': { type: 'boolean', default: false },
}, strict: true });
if (values.help) {
  console.log('pnpm bench:babel-css-extract [--modules 10000] [--lines 1200] [--runs 5] [--workers 8] [--generate-only] [--diagnostic-only]');
  process.exit(0);
}
const modules = Number(values.modules), linesPerModule = Number(values.lines), runs = Number(values.runs), workers = Number(values.workers);
for (const value of [modules, linesPerModule, runs, workers]) assert(Number.isSafeInteger(value) && value > 0);
assert(modules >= 2);
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
  const dir = path.join(root, 'results', `babel-css-extract-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`);
  for (const name of ['fixture', 'raw', 'stats', 'jobs', 'output', 'logs', 'audit', 'source']) await mkdir(path.join(dir, name), { recursive: true });
  console.log(`Results: ${dir}`);
  const fixture = await prepareFixture({ root, dir, modules, linesPerModule });
  const fixtureSha256 = hash(JSON.stringify(Object.entries(fixture.fileHashes).sort()));
  assert(fixture.minLines >= linesPerModule);
  assert(Number.isSafeInteger(fixture.expectedChecksum));
  await json(path.join(dir, 'fixture.json'), { ...fixture, modules, fixtureSha256 });
  console.log(`Fixture: ${modules} JS + ${modules} CSS modules, ${fixture.minLines}-${fixture.maxLines} lines/module, ${(fixture.totalBytes / 1024 / 1024).toFixed(2)} MiB`);
  if (values['generate-only']) return;
  const metadata = { modules, linesPerModule, runs, workers, versions, startedAt: new Date().toISOString(), fixtureSha256,
    fixture: { minLines: fixture.minLines, maxLines: fixture.maxLines, totalBytes: fixture.totalBytes, functionsPerModule: fixture.functionsPerModule },
    worktree: { path: worktreeRepository,
      head: (await execFileAsync('git', ['-C', worktreeRepository, 'rev-parse', 'HEAD'])).stdout.trim(),
      status: (await execFileAsync('git', ['-C', worktreeRepository, 'status', '--short'])).stdout.trim() },
    artifactHashes: {}, validationPairsPerGroup: 1, warmupPairsPerGroup: 1,
    conditions: 'Development bundler configuration with release native artifacts. Optimizations, incremental, Rspack caches, loader cache and Babel disk/config caches disabled. Every large JS module runs parallel Babel parse/print and imports one CSS Module, processed on main by css-loader and CssExtractRspackPlugin. Identical explicit worker counts.',
    sequence: 'Each fresh process creates one compiler: cold build, then full rebuild with all resources marked modified. Serial processes; rotating group order; OS cache retained. Validation and warmup pairs excluded from samples.',
    buildBoundary: 'compiler.run invocation through callback; excludes setup/close, stats, audits, bundle evaluation and hashing. setupAndColdBuildMs includes compiler setup because worker boot can start there. Process includes the entire two-build child lifetime and validation overhead.',
  };
  const sources = ['cases/babel-css-extract/bench.mjs', 'cases/babel-css-extract/run-build.mjs',
    'cases/babel-css-extract/fixture.mjs', 'cases/babel-css-extract/audit-preload.cjs', 'cases/babel-css-extract/diagnostics.mjs', 'cases/babel-loader-large-files/evaluate-output.cjs', 'cases/babel-loader-large-files/config.mjs', 'cases/babel-loader-large-files/versions.mjs', 'cases/babel-css-extract/config.mjs', 'cases/babel-css-extract/versions.mjs',
     'cases/babel-loader/case.mjs', 'cases/noop-loader/config.mjs',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', ...versions.map(version => `versions/${version}/package.json`)];
  for (const name of sources) {
    const data = await readFile(path.join(root, name)); metadata.artifactHashes[name] = hash(data);
    const target = path.join(dir, 'source', name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, data);
  }
  const patch = (await execFileAsync('git', ['-C', worktreeRepository, 'diff', '--binary', 'HEAD'], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  await writeFile(path.join(dir, 'worktree.patch'), patch); metadata.worktree.patchSha256 = hash(patch);
  for (const name of ['crates/rspack_js_tasks/src/timing.rs', 'crates/rspack_js_tasks/src/task.rs', 'crates/rspack_js_tasks/src/dispatcher.rs', 'crates/rspack_loader_runner/src/javascript.rs', 'crates/rspack_binding_api/src/js_tasks/tsfn.rs', 'crates/rspack_binding_api/src/js_tasks/subscription.rs', 'crates/rspack_binding_api/src/plugins/js_loader/worker.rs']) {
    const data = await readFile(path.join(worktreeRepository, name));
    const target = path.join(dir, 'source/rspack', name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, data);
    metadata.artifactHashes[`rspack/${name}`] = hash(data);
  }
  await json(path.join(dir, 'metadata.json'), metadata);
  const modes = [true];
  const groups = modes.flatMap(parallel => versions.map(version => ({ version, parallel })));
  const idFor = group => `${group.version}-parallel-${group.parallel ? 'on' : 'off'}`;
  const records = [], failures = [];
  async function execute(group, phase, round) {
    const id = `${idFor(group)}-${phase}-${round}`;
    const job = { ...group, id, phase, round, verify: phase === 'verify', modules, workers, expectedChecksum: fixture.expectedChecksum,
      fixture: fixture.fixture, fixtureSha256, output: path.join(dir, 'output', id),
      statsDirectory: path.join(dir, 'stats', id), auditDirectory: path.join(dir, 'audit', id), resultFile: path.join(dir, 'raw', `${id}.json`) };
    await mkdir(job.statsDirectory, { recursive: true }); await mkdir(job.auditDirectory, { recursive: true });
    const jobFile = path.join(dir, 'jobs', `${id}.json`); await json(jobFile, job);
    const env = { ...process.env, RSPACK_LOADER_WORKER_THREADS: String(workers) };
    delete env.RSPACK_LOADER_TIMING_FILE;
    for (const key of Object.keys(env)) if (key.startsWith('BABEL_MATRIX_')) delete env[key];
    const args = [];
    if (job.verify) {
      const req = createRequire(path.join(root, 'versions', group.version, 'package.json'));
      const loader = req.resolve('babel-loader'), loaderReq = createRequire(loader);
      Object.assign(env, { BABEL_MATRIX_AUDIT_DIR: job.auditDirectory, BABEL_MATRIX_CSS: req.resolve('css-loader'), BABEL_MATRIX_EXTRACT: req('@rspack/core').CssExtractRspackPlugin.loader, BABEL_MATRIX_LOADER: loader,
        BABEL_MATRIX_TRANSFORM: loaderReq.resolve('babel-loader/lib/transform') });
      if (group.version === worktreeVersion) env.RSPACK_LOADER_TIMING_FILE = path.join(job.auditDirectory, 'native.jsonl');
      args.push('--require', fileURLToPath(new URL('./audit-preload.cjs', import.meta.url)));
    }
    args.push(fileURLToPath(new URL('./run-build.mjs', import.meta.url)), jobFile);
    const start = process.hrtime.bigint();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 60 * 60 * 1000);
      child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); }); child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    });
    const processMs = Number(process.hrtime.bigint() - start) / 1e6;
    await writeFile(path.join(dir, 'logs', `${id}.log`), result.stdout + result.stderr);
    let record;
    if (result.code !== 0 || result.stderr.trim()) record = { ...job, status: 'failed', exitCode: result.code, signal: result.signal,
      reason: (result.stderr || result.stdout).slice(0, 4000), processMs };
    else record = JSON.parse(await readFile(job.resultFile, 'utf8'));
    record.processMs = processMs; record.executionOrder = records.length + failures.length;
    await json(job.resultFile, record);
    if (record.status !== 'passed') {
      failures.push(record); console.log(`${id}: FAILED (see raw record and log)`); return false;
    }
    const reference = records.find(r => r.version === group.version);
    if (reference) {
      assert.deepEqual(record.artifacts, reference.artifacts, 'Loaded Rspack artifacts changed');
      assert.deepEqual(record.dependencies, reference.dependencies, 'Babel dependencies changed');
      for (const build of record.builds) { assert.equal(build.validation.outputSha256, reference.builds[0].validation.outputSha256); assert.equal(build.validation.cssSha256, reference.builds[0].validation.cssSha256); }
    }
    records.push(record);
    console.log(`${id}: ${record.builds.map(b => `${b.state}=${b.timings.buildMs.toFixed(2)}ms`).join(' ')}${job.verify ? ' audit=' + JSON.stringify(record.builds.map(b => b.validation.audit)) : ''}`);
    return true;
  }
  let validationPassed = true;
  for (const group of groups) if (!await execute(group, 'verify', 0)) validationPassed = false;
  if (validationPassed) {
    const { analyzeDiagnostics } = await import('./diagnostics.mjs');
    await analyzeDiagnostics(dir, records.filter(record => record.verify));
  }
  if (validationPassed && !values['diagnostic-only']) {
    for (const group of groups) await execute(group, 'warmup', 0);
    for (let round = 1; round <= runs; round++) {
      const offset = (round - 1) % groups.length;
      for (const group of [...groups.slice(offset), ...groups.slice(0, offset)]) await execute(group, 'measure', round);
    }
  }
  for (const [name, digest] of Object.entries(fixture.fileHashes)) assert.equal(hash(await readFile(path.join(fixture.fixture, name))), digest);
  const rows = groups.map(group => {
    const samples = records.filter(r => r.phase === 'measure' && idFor(r) === idFor(group));
    const states = Object.fromEntries(['cold', 'warm'].map(state => [state,
      Object.fromEntries(['buildMs', 'makeMs', 'finishMakeMs', 'sealMs', 'emitMs'].map(key =>
        [key, distribution(samples.map(r => r.builds.find(b => b.state === state).timings[key]))]))]));
    return { ...group, states, successfulSamples: samples.length,
      failedSamples: failures.filter(r => r.phase === 'measure' && idFor(r) === idFor(group)).length,
      processMs: distribution(samples.map(r => r.processMs)), compilerSetupMs: distribution(samples.map(r => r.compilerSetupMs)),
      setupAndColdBuildMs: distribution(samples.map(r => r.setupAndColdBuildMs)) };
  });
  metadata.finishedAt = new Date().toISOString(); metadata.fixtureUnchanged = true; metadata.failedPairs = failures.length;
  await json(path.join(dir, 'failures.json'), failures); await json(path.join(dir, 'metadata.json'), metadata);
  await json(path.join(dir, 'summary.json'), { metadata, rows, failures });
  const fmt = d => d.median === null ? 'no samples' : `${d.median.toFixed(2)} [${d.min.toFixed(2)}, ${d.max.toFixed(2)}]`;
  const lines = ['# Parallel Babel + main-thread CSS extraction benchmark', '', metadata.conditions, '', metadata.sequence, '',
    `${modules} modules; ${fixture.minLines}-${fixture.maxLines} lines per module; ${(fixture.totalBytes / 1024 / 1024).toFixed(2)} MiB input; ${workers} workers; one CSS Module per JS module; CSS extraction on main. One validation and one warmup pair, then ${runs} measured pairs per group.`, '',
    `Worktree HEAD: ${metadata.worktree.head}; status: ${metadata.worktree.status || 'clean'}.`, '',
    'Milliseconds: median [min, max]. Full rebuild forces every module through Babel again.', '',
    '| Version | parallel | Setup + cold build | Cold build | Full rebuild | Cold make | Rebuild make | Samples |', '|---|---|---:|---:|---:|---:|---:|---:|'];
  for (const row of rows) lines.push(`| ${row.version} | ${row.parallel ? 'on' : 'off'} | ${[row.setupAndColdBuildMs, row.states.cold.buildMs, row.states.warm.buildMs, row.states.cold.makeMs, row.states.warm.makeMs].map(fmt).join(' | ')} | ${row.successfulSamples}/${runs} |`);
  lines.push('', '| Mode | Branch vs 2.2.6: setup + cold | Branch vs 2.2.6: full rebuild |', '|---|---:|---:|');
  for (const parallel of modes) {
    const baseline = rows.find(row => row.version === 'v2-2-6' && row.parallel === parallel);
    const branch = rows.find(row => row.version === worktreeVersion && row.parallel === parallel);
    const delta = (a, b) => a.median === null || b.median === null ? 'no samples' : `${((a.median / b.median - 1) * 100).toFixed(2)}%`;
    lines.push(`| ${parallel ? 'parallel' : 'main'} | ${delta(branch.setupAndColdBuildMs, baseline.setupAndColdBuildMs)} | ${delta(branch.states.warm.buildMs, baseline.states.warm.buildMs)} |`);
  }
  const environment = records[0]?.environment;
  if (environment) lines.push('', `Environment: Node ${environment.node}; ${environment.platform}/${environment.arch}; ${environment.cpu}; ${environment.cpus} logical CPUs (${environment.availableParallelism} available). Negative percentages mean less time.`, '');
  lines.push('', `Failed pairs: ${failures.length}; no automatic retries.`, '',
    '| Group | Cold / rebuild Babel / CSS / extract pitch calls | Execution thread IDs |', '|---|---:|---|');
  for (const r of records.filter(r => r.verify)) lines.push(`| ${idFor(r)} | ${r.builds.map(b => `${b.validation.audit.transform} Babel + ${b.validation.audit.css} CSS + ${b.validation.audit.extract} extract pitch`).join(' / ')} | ${r.builds[0].validation.audit.threadIds.join(', ')} |`);
  lines.push('', `Timing: ${metadata.buildBoundary}`, '',
    'Validation instruments the actual Babel loader and transform in every thread. Measured runs contain no audit preload. Every build checks freshly built modules, exact loader chain, resource set and a streaming output hash. Only cold validation builds evaluate the bundle in a separate Node process with a 24 GiB heap limit; exported value and checksum evaluate all generated functions. All later outputs must match the validated hash. Output hashes must match within each version across repetitions and main/worker settings. Rspack artifact and Babel dependency hashes must remain unchanged.', '',
    'This generated workload combines parallel Babel parse/print with real css-loader and CSS extraction, including nested importModule builds. Diagnostics use per-loader timers and branch native task timings, and are excluded from performance samples. The overhead report distinguishes queue/event-loop waiting from context preparation and merge; concurrent latency sums are not build wall time or CPU time. Whole-build comparisons include changes between versions beyond queue dispatch. Ranges are descriptive; machine activity and OS caches are not controlled. Raw records include setup/process timings and environment.', '',
    'Sources/lockfile: source/. Native/core hashes, timings, configuration: raw/. Validation thread audits: audit/. Full stats: stats/. Source file hashes: fixture.json. Local source changes: worktree.patch.', '');
  await writeFile(path.join(dir, 'report.md'), lines.join('\n'));

  await writeFile(path.join(root, 'results/latest-babel-css-extract.txt'), dir + '\n');
  console.log(`Report: ${path.join(dir, 'report.md')}`);
  if (failures.length) process.exitCode = 1;
}

function distribution(values) {
  if (!values.length) return { median: null, min: null, max: null, samples: [] };
  const sorted = [...values].sort((a,b) => a-b), mid = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid])/2, min: sorted[0], max: sorted.at(-1), samples: values };
}
