#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
  copyFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cases, generate } from './fixture.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)),
  root = path.resolve(here, '../..');
const { values: a } = parseArgs({
  options: {
    builds: { type: 'string' },
    core: { type: 'string' },
    dependencies: {
      type: 'string',
      default: path.join(root, 'versions/local'),
    },
    output: {
      type: 'string',
      default: path.join(
        root,
        'results',
        `placeholder-memory-${new Date().toISOString().replaceAll(':', '-')}`,
      ),
    },
    modules: { type: 'string', default: '1000' },
    rules: { type: 'string', default: '32' },
    runs: { type: 'string', default: '5' },
    workers: { type: 'string', default: '8' },
    cases: { type: 'string', default: cases.join(',') },
    versions: { type: 'string', default: 'main,branch' },
  },
});
assert(
  a.builds && a.core,
  'Required: --builds /absolute/builds.json --core /absolute/packages/rspack/dist/index.js',
);
for (const key of ['modules', 'rules', 'runs', 'workers'])
  assert(Number.isSafeInteger(Number(a[key])) && Number(a[key]) > 0, key);
assert(Number(a.modules) >= 4, 'At least 4 modules for sync/async coverage');
const selected = a.cases.split(',');
selected.forEach((x) => assert(cases.includes(x), x));
const versions = a.versions.split(',');
assert(versions.every((x) => ['main', 'branch'].includes(x)));
const builds = JSON.parse(await readFile(a.builds, 'utf8'));
const out = path.resolve(a.output),
  fixture = path.join(out, 'fixture');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const version of versions)
  assert.equal(
    hash(await readFile(builds.versions[version].native)),
    builds.versions[version].nativeSha256,
    `Native hash ${version}`,
  );
const lock = path.join(root, '.bench-running');
await mkdir(lock); // Atomic: do not run alongside another benchmark in this repository.
await writeFile(
  path.join(lock, 'owner.json'),
  JSON.stringify({ pid: process.pid, case: 'placeholder-memory', output: out }),
);
const json = (file, value) =>
  writeFile(file, JSON.stringify(value, null, 2) + '\n');
try {
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out); // Refuse to overwrite an earlier result, including failed runs.
  for (const dir of ['raw', 'jobs', 'logs', 'source', 'output'])
    await mkdir(path.join(out, dir), { recursive: true });
  for (const file of await readdir(here))
    if (/\.(?:mjs|py|rs|md)$/.test(file))
      await copyFile(path.join(here, file), path.join(out, 'source', file));
  for (const version of versions)
    await copyFile(
      path.join(path.dirname(a.builds), `${version}-instrumentation.patch`),
      path.join(out, 'source', `${version}-instrumentation.patch`),
    );
  const coreHashes = {};
  async function hashTree(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) await hashTree(file);
      else if (file.endsWith('.js'))
        coreHashes[path.relative(path.dirname(a.core), file)] = hash(
          await readFile(file),
        );
    }
  }
  await hashTree(path.dirname(a.core));
  const deps = createRequire(
    path.join(path.resolve(a.dependencies), 'package.json'),
  );
  const dependencies = {
    'css-loader': {
      version: deps('css-loader/package.json').version,
      entry: deps.resolve('css-loader'),
      sha256: hash(await readFile(deps.resolve('css-loader'))),
    },
  };
  await json(path.join(out, 'metadata.json'), {
    args: a,
    builds,
    coreHashes,
    dependencies,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0].model,
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
    },
  });
  await generate(fixture, Number(a.modules), Number(a.rules));
  const audits = {},
    rows = [];
  async function run(version, scenario, run, audit) {
    const id = `${scenario}-${version}-${run}`;
    const job = {
      version,
      scenario,
      run,
      audit,
      fixture,
      modules: Number(a.modules),
      native: builds.versions[version].native,
      core: path.resolve(a.core),
      dependencies: path.resolve(a.dependencies),
      output: path.join(out, 'output', id),
      result: path.join(out, 'raw', `${id}.json`),
    };
    const jobFile = path.join(out, 'jobs', `${id}.json`);
    await json(jobFile, job);
    const log = [];
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(here, 'run-build.mjs'), jobFile],
        {
          env: {
            ...process.env,
            NAPI_RS_NATIVE_LIBRARY_PATH: job.native,
            RAYON_NUM_THREADS: a.workers,
            RSPACK_NUM_THREADS: a.workers,
            RSPACK_LOADER_WORKER_THREADS: a.workers,
            UV_THREADPOOL_SIZE: a.workers,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${id} exceeded 5 minutes`));
      }, 300000);
      child.stdout.on('data', (x) => {
        log.push(x);
        process.stdout.write(x);
      });
      child.stderr.on('data', (x) => log.push(x));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', async (code) => {
        clearTimeout(timer);
        await writeFile(
          path.join(out, 'logs', `${id}.log`),
          Buffer.concat(log),
        );
        if (code !== 0)
          reject(new Error(`${id} failed (${code})\n${Buffer.concat(log)}`));
        else resolve();
      });
    });
    const result = JSON.parse(await readFile(job.result, 'utf8'));
    if (audit) {
      if (audits[scenario])
        assert.deepEqual(
          result.outputHashes,
          audits[scenario].outputHashes,
          `${scenario}: main/branch outputs differ`,
        );
      audits[scenario] = result;
    } else {
      assert.deepEqual(
        result.outputHashes,
        audits[scenario].outputHashes,
        `${id}: output differs from audited build`,
      );
      rows.push(result);
    }
    await rm(job.output, { recursive: true });
  }
  // Audit doubles as an excluded warmup; each measured sample still starts a fresh process.
  for (const scenario of selected)
    for (const version of versions) await run(version, scenario, 'audit', true);
  for (let runId = 0; runId < Number(a.runs); runId++) {
    const order = runId % 2 ? [...versions].reverse() : versions;
    const scenarioOrder = [
      ...selected.slice(runId % selected.length),
      ...selected.slice(0, runId % selected.length),
    ];
    for (const scenario of scenarioOrder)
      for (const version of order) await run(version, scenario, runId, false);
  }
  const median = (xs) => {
    const sorted = [...xs].sort((a, b) => a - b),
      mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const metrics = [
    'peakBytes',
    'peakAboveBaselineBytes',
    'liveBytes',
    'liveAboveBaselineBytes',
    'allocatedBytes',
    'allocationCalls',
  ];
  const summary = selected.map((scenario) => {
    const row = { scenario, versions: {} };
    for (const version of versions)
      row.versions[version] = Object.fromEntries(
        metrics.map((metric) => {
          const xs = rows
            .filter((x) => x.scenario === scenario && x.version === version)
            .map((x) => x[metric]);
          return [
            metric,
            { median: median(xs), min: Math.min(...xs), max: Math.max(...xs) },
          ];
        }),
      );
    if (versions.length === 2)
      row.deltaPercent = Object.fromEntries(
        metrics.map((metric) => [
          metric,
          (row.versions.branch[metric].median /
            row.versions.main[metric].median -
            1) *
            100,
        ]),
      );
    return row;
  });
  await json(path.join(out, 'summary.json'), summary);
  const mib = (bytes) => (bytes / 2 ** 20).toFixed(2),
    pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  const report = [
    '# PR #15808 Rust memory comparison',
    '',
    `main: \`${builds.versions.main?.sha}\`; branch: \`${builds.versions.branch?.sha}\`.`,
    '',
    `${a.modules} modules per scenario; ${a.rules} CSS rules per module (+ one inline rule); ${a.runs} fresh-process cold builds/version/scenario; ${a.workers} workers. Audit builds excluded. Medians below.`,
    '',
    'Rust requested heap only: identical GlobalAlloc counters around mimalloc; Node/V8, allocator metadata, fragmentation, stack and direct C allocations excluded. Peak is the absolute live-byte high watermark from compiler construction through compiler.run callback; live is sampled at that callback before stats conversion/validation/close. Allocation volume counts alloc/alloc_zeroed sizes and full successful realloc requested sizes. Internal temporary realloc overlap is not measured.',
    '',
    'One shared compiled JS wrapper is used with two exact native binaries. Native SHA-256, all compiled JS SHA-256, source revisions, instrumentation patches, environment and raw samples are archived. Both builds use release opt-level=3, LTO off, 16 codegen units, info-level, identical dependencies and allocator. Atomic instrumentation affects time, so elapsed time is diagnostic only.',
    '',
    '| Scenario | main peak MiB | branch peak MiB | Δ peak | main live MiB | branch live MiB | main allocated MiB | branch allocated MiB | Δ allocated |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of summary)
    if (row.versions.main && row.versions.branch) {
      const m = row.versions.main,
        b = row.versions.branch;
      report.push(
        `| ${row.scenario} | ${mib(m.peakBytes.median)} | ${mib(b.peakBytes.median)} | ${pct(row.deltaPercent.peakBytes)} | ${mib(m.liveBytes.median)} | ${mib(b.liveBytes.median)} | ${mib(m.allocatedBytes.median)} | ${mib(b.allocatedBytes.median)} | ${pct(row.deltaPercent.allocatedBytes)} |`,
      );
    }
  report.push(
    '',
    'Per-scenario peaks must not be summed: scenarios run in independent processes. See summary.json for baseline-adjusted metrics, allocation counts and min/max spread.',
    '',
    'All emitted files are checked for unresolved placeholders. Output SHA-256 must match between versions and every measured build. Additional assertions check lazy CSS, CSS text, module IDs, relative publicPath, inline assets, SRI algorithms, worker files, preserved ESM asset imports, dynamic ESM links, all four Rstest operations and Node external forms. Audit raw files contain generated-source, early processAssets and executed CSS-loader marker counts.',
    '',
  );
  await writeFile(path.join(out, 'report.md'), report.join('\n'));
  console.log(`Results: ${out}`);
} finally {
  await rm(lock, { recursive: true });
}
