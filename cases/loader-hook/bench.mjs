#!/usr/bin/env zx
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const scriptIndex = process.argv.findIndex((arg, index) => index > 0 && path.resolve(arg) === script);
const { values } = parseArgs({ args: process.argv.slice(scriptIndex + 1), options: {
  modules: { type: 'string', default: '10000' }, runs: { type: 'string', default: '5' },
  help: { type: 'boolean', default: false },
}, strict: true });
if (values.help) {
  console.log('pnpm bench:loader-hook [--modules 10000] [--runs 5]');
  process.exit(0);
}
const modules = Number(values.modules), runs = Number(values.runs);
assert(Number.isSafeInteger(modules) && modules > 0 && Number.isSafeInteger(modules * (modules - 1) / 2));
assert(Number.isSafeInteger(runs) && runs > 0);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const lock = path.join(root, '.bench-running');
await mkdir(lock);
try {
  await json(path.join(lock, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString() });
  await main();
} finally {
  await rm(lock, { recursive: true, force: true });
}

async function main() {
  const dir = path.join(root, 'results', `loader-hook-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`);
  for (const name of ['fixture', 'raw', 'stats', 'jobs', 'output', 'logs']) await mkdir(path.join(dir, name), { recursive: true });
  console.log(`Results: ${dir}`);
  const fileHashes = {};
  const fixture = path.join(dir, 'fixture');
  for (let base = 0; base < modules; base += 128) {
    await Promise.all(Array.from({ length: Math.min(128, modules - base) }, async (_, offset) => {
      const i = base + offset;
      const children = [2 * i + 1, 2 * i + 2].filter(id => id < modules);
      const source = children.map((id, index) => `import { value as child${index} } from './module-${String(id).padStart(5, '0')}.js';`).join('\n') +
        `\nexport const value = ${i}${children.map((_, index) => ` + child${index}`).join('')};\n`;
      const name = `module-${String(i).padStart(5, '0')}.js`;
      await writeFile(path.join(fixture, name), source);
      fileHashes[name] = hash(source);
    }));
  }
  const fixtureSha256 = hash(JSON.stringify(Object.entries(fileHashes).sort()));
  await json(path.join(dir, 'fixture.json'), { modules, graph: 'Binary tree of JS imports; entry is module-00000.js', fixtureSha256, fileHashes });
  const metadata = { modules, runs, versions: ['v2', 'local'], startedAt: new Date().toISOString(), fixtureSha256,
    validationPerGroup: 1, warmupsPerGroup: 1, artifactHashes: {},
    conditions: 'Development; all optimization flags disabled; no cache/incremental; only noop.cjs, parallel:false. No React, CSS or builtin loaders. Serial fresh Node processes; rotating measurement order; OS cache retained.',
    buildBoundary: 'compiler.run invocation to callback, excluding setup/close, stats, bundle execution and artifact hashing',
  };
  for (const name of ['cases/loader-hook/bench.mjs', 'cases/loader-hook/run-build.mjs', 'cases/loader-hook/config.mjs',
    'loaders/noop.cjs', 'versions.mjs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'versions/v2/package.json', 'versions/local/package.json']) metadata.artifactHashes[name] = hash(await readFile(path.join(root, name)));
  await json(path.join(dir, 'metadata.json'), metadata);
  const groups = [false, true].flatMap(hook => ['v2', 'local'].map(version => ({ version, hook })));
  const results = [];
  async function execute(group, phase, round) {
    const id = `${group.version}-hook-${group.hook ? 'on' : 'off'}-${phase}-${round}`;
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
    const reference = results.find(r => r.version === group.version);
    if (reference) {
      assert.deepEqual(result.artifacts, reference.artifacts, 'Rspack artifacts changed during measurement');
      assert.equal(result.compiledVersion, reference.compiledVersion);
      assert.equal(result.validation.bundleSha256, reference.validation.bundleSha256, 'Hook registration or repetition changed the output');
    }
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
    const samples = results.filter(r => r.phase === 'measure' && r.version === group.version && r.hook === group.hook);
    assert.equal(samples.length, runs);
    return { ...group, timings: Object.fromEntries(Object.keys(samples[0].timings).map(key => [key, distribution(samples.map(r => r.timings[key]))])) };
  });
  const overheads = Object.fromEntries(['v2', 'local'].map(version => {
    const off = rows.find(r => r.version === version && !r.hook).timings;
    const on = rows.find(r => r.version === version && r.hook).timings;
    return [version, Object.fromEntries(Object.keys(off).map(key => [key, { differenceMs: on[key].median - off[key].median, ratio: on[key].median / off[key].median }]))];
  }));
  const comparisons = [false, true].map(hook => ({ hook, localOverPublished:
    rows.find(r => r.version === 'local' && r.hook === hook).timings.buildMs.median /
    rows.find(r => r.version === 'v2' && r.hook === hook).timings.buildMs.median }));
  const overheadDifferenceMs = overheads.local.buildMs.differenceMs - overheads.v2.buildMs.differenceMs;
  metadata.finishedAt = new Date().toISOString();
  metadata.fixtureUnchanged = true;
  await json(path.join(dir, 'metadata.json'), metadata);
  await json(path.join(dir, 'summary.json'), { metadata, rows, overheads, comparisons, overheadDifferenceMs });
  const fmt = n => n.toFixed(2);
  const lines = ['# NormalModule loader hook benchmark', '', metadata.conditions, '',
    `${modules} plain JS modules, each running exactly one noop JS loader. Four groups: 2.2.3/local × hook absent/empty tap. One validation, one warmup and ${runs} measured builds per group.`, '',
    'The tap is registered using compiler.hooks.compilation → NormalModule.getCompilationHooks(compilation).loader.tap. The no-hook group does not register or retrieve this hook in benchmark code. Measured taps are empty; validation alone counts hook and noop calls.', '',
    '| Group | Package / compiled core | Noop calls | Hook calls |', '|---|---|---:|---:|'];
  for (const r of results.filter(r => r.verify)) lines.push(`| ${r.version}, hook ${r.hook} | ${r.packageVersion} / ${r.compiledVersion} | ${r.validation.noopCalls} | ${r.validation.hookCalls} |`);
  lines.push('', 'Times in milliseconds: median [min, max].', '',
    '| Group | Build | make | finishMake | seal | emit | Process |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) lines.push(`| ${r.version}, hook ${r.hook} | ` + ['buildMs', 'makeMs', 'finishMakeMs', 'sealMs', 'emitMs', 'processMs'].map(key => {
    const t = r.timings[key]; return `${fmt(t.median)} [${fmt(t.min)}, ${fmt(t.max)}]`;
  }).join(' | ') + ' |');
  lines.push('', '| Version | Hook build overhead (on − off) | On / off |', '|---|---:|---:|');
  for (const [version, item] of Object.entries(overheads)) lines.push(`| ${version} | ${fmt(item.buildMs.differenceMs)} ms | ${item.buildMs.ratio.toFixed(3)}× |`);
  lines.push('', `Difference of hook overheads (local − 2.2.3): ${fmt(overheadDifferenceMs)} ms.`, '');
  for (const c of comparisons) lines.push(`- Hook ${c.hook}: local / 2.2.3 = ${c.localOverPublished.toFixed(3)}×.`);
  lines.push('', `Build timing: ${metadata.buildBoundary}. make: make → finishMake; finishMake: finishMake → seal; seal: seal → afterSeal; emit: emit → afterEmit. Process includes all worker work.`, '',
    'Verification checks every noop/hook resource, exact loader chains in stats, and the exported sum after executing the bundle. Outputs must be byte-identical within each version with/without the tap and across repetitions. Native/core paths and artifact hashes are saved for both versions and checked between builds.', '',
    'These are whole-build comparisons of two different builds. The within-version on/off comparison estimates tap registration overhead; the difference of overheads is not proof that only one source change is responsible. Samples and ranges are descriptive, with uncontrolled background machine activity.', '',
    'Raw configs, environment, output hashes and timings: raw/. Stats: stats/. Fixture hashes: fixture.json. Source/lock hashes: metadata.json. Outputs: output/. Logs: logs/.', '');
  await writeFile(path.join(dir, 'report.md'), lines.join('\n'));
  await writeFile(path.join(root, 'results', 'latest-loader-hook.txt'), dir + '\n');
  console.log(`Report: ${path.join(dir, 'report.md')}`);
}

function distribution(samples) {
  const sorted = [...samples].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    min: sorted[0], max: sorted.at(-1), samples };
}
