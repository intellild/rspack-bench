#!/usr/bin/env zx
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.dirname(fileURLToPath(import.meta.url));
const scriptIndex = process.argv.findIndex((arg, index) => index > 0 && path.resolve(arg) === fileURLToPath(import.meta.url));
assert(scriptIndex > 0, 'Cannot locate benchmark script in argv');
const { values } = parseArgs({ args: process.argv.slice(scriptIndex + 1), options: {
  modules: { type: 'string', default: '10000' },
  runs: { type: 'string', default: '5' },
  supplement: { type: 'string', default: 'auto' },
  styles: { type: 'string', default: 'less' },
  help: { type: 'boolean', default: false },
}, strict: true });
if (values.help) {
  console.log('npx zx bench.mjs [--modules 10000] [--runs 5] [--styles less|css] [--supplement auto|always|never]');
  process.exit(0);
}
const modules = Number(values.modules);
const runs = Number(values.runs);
assert(Number.isSafeInteger(modules) && modules > 0, '--modules must be a positive integer');
assert(Number.isSafeInteger(runs) && runs > 0, '--runs must be a positive integer');
assert(['auto', 'always', 'never'].includes(values.supplement), 'Invalid --supplement');
assert(['less', 'css'].includes(values.styles), 'Invalid --styles');
const req = createRequire(import.meta.url);
assert.equal(req('zx/package.json').version, '8.8.5');
for (const version of ['v1', 'v2']) {
  const versionReq = createRequire(path.join(root, 'versions', version, 'package.json'));
  assert.equal(versionReq('@rspack/core/package.json').version, version === 'v1' ? '1.7.11' : '2.2.3');
  assert.equal(versionReq('css-loader/package.json').version, '7.1.5');
  assert.equal(versionReq('less-loader/package.json').version, '13.0.0');
  assert.equal(versionReq('less').version.join('.'), '4.9.1');
}

// A concurrent invocation must not replace the fixture underneath live workers.
const lock = path.join(root, '.bench-running');
await mkdir(lock).catch(error => {
  throw new Error('Cannot acquire .bench-running. Check for a live bench process before removing a stale lock.', { cause: error });
});
try {
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await main();
} finally {
  await rm(lock, { recursive: true, force: true });
}

async function main() {
  const session = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-') + `-${process.pid}`;
  const resultDir = path.join(root, 'results', session);
  for (const dir of ['raw', 'stats', 'jobs', 'logs', 'output']) await mkdir(path.join(resultDir, dir), { recursive: true });
  console.log(`Results: ${resultDir}`);
  console.log(`Node ${process.version}; ${os.platform()} ${os.release()} ${os.arch()}; CPU ${os.cpus()[0]?.model}; logical=${os.cpus().length}, available=${os.availableParallelism()}`);
  console.log('Generating shared CSS fixture (outside timers)…');
  const fixture = await generateFixture();
  await writeJson(path.join(resultDir, 'fixture.json'), fixture);
  const metadata = {
    session, modules, runs, styles: values.styles, warmupsPerGroup: 1, supplement: values.supplement,
    startedAt: new Date().toISOString(), fixtureSha256: fixture.sha256,
    regressionRule: 'At least 10% slower median build, and v2 minimum > v1 maximum. Descriptive gate, not a significance test.',
    timingBoundaries: { buildMs: 'compiler.run invocation → callback (excludes compiler setup/close and stats)',
      makeMs: 'compiler.make (early) → compiler.finishMake (early)',
      finishMakeMs: 'compiler.finishMake (early) → compilation.seal (early); includes module graph finishing',
      sealMs: 'compilation.seal (early) → compilation.afterSeal (late)',
      emitMs: 'compiler.emit (early) → compiler.afterEmit (late)',
      processMs: 'parent spawn → child exit, including startup, package load, setup/close, stats and JSON IO' },
    conditions: 'Development mode; all exposed optimization switches disabled and checked against compiler.options; natural module/chunk IDs; serial fresh Node processes; cache/incremental disabled; no OS file cache flush; no per-module instrumentation outside validation.',
    artifactHashes: {},
  };
  for (const name of ['bench.mjs', 'run-build.mjs', 'loaders/noop.cjs', 'package.json', 'package-lock.json',
    'versions/v1/package.json', 'versions/v1/package-lock.json', 'versions/v2/package.json', 'versions/v2/package-lock.json']) {
    metadata.artifactHashes[name] = hash(await readFile(path.join(root, name)));
  }
  await writeJson(path.join(resultDir, 'metadata.json'), metadata);
  const allResults = [];
  const suites = [];
  async function execute(group, phase, round) {
    const id = `${values.styles}-${group.topology}-${group.version}-${group.mode}-${phase}-${round}`;
    const job = { ...group, id, phase, round, modules, styles: values.styles, verify: phase === 'verify',
      fixtureSha256: fixture.sha256,
      output: path.join(resultDir, 'output', id),
      statsFile: path.join(resultDir, 'stats', `${id}.json`),
      resultFile: path.join(resultDir, 'raw', `${id}.json`) };
    await mkdir(job.output);
    const jobFile = path.join(resultDir, 'jobs', `${id}.json`);
    await writeJson(jobFile, job);
    const child = await runWorker(jobFile);
    const processMs = child.processMs;
    await writeFile(path.join(resultDir, 'logs', `${id}.log`), child.stdout + child.stderr);
    assert.equal(child.exitCode, 0, `Build failed: ${id}\n${child.stdout}\n${child.stderr}`);
    assert.equal(child.stderr.trim(), '', `Unexpected process warning: ${child.stderr}`);
    const result = JSON.parse(await readFile(job.resultFile, 'utf8'));
    result.timings.processMs = processMs;
    result.executionOrder = allResults.length;
    await writeJson(job.resultFile, result);
    allResults.push(result);
    console.log(`${id}: core=${result.packageVersions.core} binding=${result.packageVersions.binding} native=${result.packageVersions.nativeBinding} less-loader=${result.packageVersions.lessLoader ?? 'none'} less=${result.packageVersions.less ?? 'none'} build=${result.timings.buildMs.toFixed(2)}ms process=${processMs.toFixed(2)}ms`);
    return result;
  }
  async function suite(name, groups) {
    const validation = [];
    for (const group of groups) validation.push(await execute(group, 'verify', 0));
    for (const version of ['v1', 'v2']) {
      const native = validation.find(r => r.version === version && r.mode === 'native');
      const noop = validation.find(r => r.version === version && r.mode === 'noop');
      if (native && noop) assert.deepEqual(native.validation.cssAssets, noop.validation.cssAssets,
        `${version}: native and noop CSS output must be byte-identical`);
    }
    // Every group gets exactly one warmup before any measured run in this suite.
    for (const group of groups) await execute(group, 'warmup', 0);
    for (let round = 1; round <= runs; round++) {
      // Rotate the order to distribute position effects, while staying fully serial.
      const offset = (round - 1) % groups.length;
      const order = [...groups.slice(offset), ...groups.slice(0, offset)];
      for (const group of order) {
        const result = await execute(group, 'measure', round);
        const reference = validation.find(r => r.version === group.version && r.mode === group.mode);
        assert.deepEqual(result.validation.cssAssets, reference.validation.cssAssets, 'Output changed across runs');
      }
    }
    const measured = allResults.filter(r => r.phase === 'measure' && groups.some(g =>
      g.version === r.version && g.mode === r.mode && g.topology === r.topology));
    const summary = summarize(name, groups, measured);
    suites.push(summary);
    await saveReport();
    return summary;
  }
  const primary = await suite(`native-${values.styles}`, ['native', 'noop'].flatMap(mode =>
    ['v1', 'v2'].map(version => ({ version, mode, topology: 'flat' }))));
  if (values.supplement === 'always' || (values.supplement === 'auto' && (values.styles === 'less' || !primary.obviousRegression))) {
    console.log('Running separate css-loader + CssExtractRspackPlugin comparison.');
    const extract = await suite('extract-flat', ['v1', 'v2'].map(version => ({ version, mode: 'extract', topology: 'flat' })));
    if (values.supplement === 'always' || !extract.obviousRegression) {
      console.log('Running layered JS imports and shared CSS dependency comparison.');
      await suite('extract-layered', ['v1', 'v2'].map(version => ({ version, mode: 'extract', topology: 'layered' })));
    }
  }
  // Check the fixture itself was not changed during the experiment.
  const after = await fingerprintFixture();
  assert.equal(after.sha256, fixture.sha256, 'Fixture changed during benchmark');
  metadata.finishedAt = new Date().toISOString();
  metadata.fixtureUnchanged = true;
  await writeJson(path.join(resultDir, 'metadata.json'), metadata);
  await saveReport();
  await writeFile(path.join(root, 'results', 'latest.txt'), resultDir + '\n');
  console.log(`Report: ${path.join(resultDir, 'report.md')}`);

  async function saveReport() {
    await writeJson(path.join(resultDir, 'summary.json'), { metadata, suites });
    await writeFile(path.join(resultDir, 'report.md'), renderReport(metadata, suites, allResults));
  }
}

function runWorker(jobFile) {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const child = spawn(process.execPath, [path.join(root, 'run-build.mjs'), jobFile], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', (exitCode, signal) => {
      const processMs = Number(process.hrtime.bigint() - start) / 1e6;
      clearTimeout(timeout);
      resolve({ exitCode, signal, stdout, stderr, processMs });
    });
  });
}

async function generateFixture() {
  const fixture = path.join(root, 'fixture');
  await rm(fixture, { recursive: true, force: true });
  await mkdir(path.join(fixture, 'styles'), { recursive: true });
  const filename = i => `style-${String(i).padStart(5, '0')}.${values.styles}`;
  // Bounded concurrency, entirely before spawning any timed worker.
  for (let base = 0; base < modules; base += 128) {
    await Promise.all(Array.from({ length: Math.min(128, modules - base) }, (_, n) => {
      const i = base + n;
      const css =
        `.bench_${i} { color: #123456; margin: 0; padding: 1px; }\n` +
        `.bench_${i}:hover { color: #654321; margin: 1px; padding: 0; }\n` +
        `.bench_${i} > span { display: block; width: 10px; height: 10px; }\n`;
      const less = `@base: #123456;\n@hover: #654321;\n@gap: 1px;\n` +
        `.dimensions(@size) { display: block; width: @size; height: @size; }\n` +
        `.bench_${i} {\n  color: @base; margin: 0; padding: @gap;\n` +
        `  &:hover { color: @hover; margin: @gap; padding: 0; }\n` +
        `  > span { .dimensions((5px * 2)); }\n}\n`;
      return writeFile(path.join(fixture, 'styles', filename(i)), values.styles === 'less' ? less : css);
    }));
  }
  await writeFile(path.join(fixture, 'index.js'), Array.from({ length: modules }, (_, i) =>
    `import './styles/${filename(i)}';`).join('\n') + '\n');
  const groupCount = Math.min(100, Math.ceil(Math.sqrt(modules)));
  const sharedCount = Math.min(100, Math.max(1, Math.floor(modules / 10)));
  const sectionCount = Math.min(10, groupCount);
  await mkdir(path.join(fixture, 'topology', 'groups'), { recursive: true });
  await mkdir(path.join(fixture, 'topology', 'sections'), { recursive: true });
  for (let group = 0; group < groupCount; group++) {
    const ids = new Set(Array.from({ length: sharedCount }, (_, i) => i));
    for (let i = group; i < modules; i += groupCount) ids.add(i);
    await writeFile(path.join(fixture, 'topology', 'groups', `group-${group}.js`),
      [...ids].map(i => `import '../../styles/${filename(i)}';`).join('\n') + '\n');
  }
  for (let section = 0; section < sectionCount; section++) {
    const imports = [];
    for (let group = section; group < groupCount; group += sectionCount) imports.push(`import '../groups/group-${group}.js';`);
    await writeFile(path.join(fixture, 'topology', 'sections', `section-${section}.js`), imports.join('\n') + '\n');
  }
  await writeFile(path.join(fixture, 'topology', 'index.js'), Array.from({ length: sectionCount }, (_, i) =>
    `import './sections/section-${i}.js';`).join('\n') + '\n');
  return { modules, styles: values.styles, rulesPerFile: 3, declarationsPerRule: 3,
    lessFeatures: values.styles === 'less' ? ['variables', 'parametric mixin', 'nested selectors', 'arithmetic'] : [],
    topology: { groupCount, sectionCount, sharedCount }, ...await fingerprintFixture() };
}

async function fingerprintFixture() {
  const base = path.join(root, 'fixture');
  const files = [];
  async function walk(dir) {
    for (const item of await readdir(path.join(base, dir), { withFileTypes: true })) {
      const name = path.join(dir, item.name);
      if (item.isDirectory()) await walk(name);
      else files.push(name);
    }
  }
  await walk('');
  files.sort();
  const digest = createHash('sha256');
  const fileHashes = {};
  for (const file of files) {
    const bytes = await readFile(path.join(base, file));
    fileHashes[file] = hash(bytes);
    digest.update(file + '\0' + fileHashes[file] + '\n');
  }
  return { sha256: digest.digest('hex'), fileHashes };
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function writeJson(filename, value) { await writeFile(filename, JSON.stringify(value, null, 2) + '\n'); }
function distribution(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0], max: sorted.at(-1), samples: numbers };
}
function summarize(name, groups, results) {
  const rows = groups.map(group => {
    const samples = results.filter(r => r.version === group.version && r.mode === group.mode);
    assert.equal(samples.length, runs);
    return { ...group, timings: Object.fromEntries(Object.keys(samples[0].timings).map(key =>
      [key, distribution(samples.map(s => s.timings[key]))])) };
  });
  const comparisons = [...new Set(groups.map(g => g.mode))].map(mode => {
    const v1 = rows.find(r => r.version === 'v1' && r.mode === mode).timings.buildMs;
    const v2 = rows.find(r => r.version === 'v2' && r.mode === mode).timings.buildMs;
    const ratio = v2.median / v1.median;
    return { mode, v2OverV1: ratio, obviousRegression: ratio >= 1.1 && v2.min > v1.max };
  });
  const overheads = name.startsWith('native-') ? Object.fromEntries(['v1', 'v2'].map(version => {
    const native = rows.find(r => r.version === version && r.mode === 'native').timings;
    const noop = rows.find(r => r.version === version && r.mode === 'noop').timings;
    return [version, Object.fromEntries(Object.keys(native).map(key => [key, noop[key].median - native[key].median]))];
  })) : null;
  const overheadDelta = overheads ? Object.fromEntries(Object.keys(overheads.v1).map(key =>
    [key, overheads.v2[key] - overheads.v1[key]])) : null;
  return { name, rows, comparisons, overheads, overheadDelta,
    obviousRegression: comparisons.some(c => c.obviousRegression) };
}

function renderReport(meta, suites, results) {
  const env = results[0].environment;
  const fmt = number => number.toFixed(2);
  const lines = [`# Rspack ${meta.styles.toUpperCase()} benchmark`, '',
    `Session: ${meta.session}. Status: ${meta.finishedAt ? 'complete' : 'in progress'}.`, '',
    `Fixture: ${meta.modules} .${meta.styles} files, producing 3 CSS rules × 3 declarations per file. SHA-256: \`${meta.fixtureSha256}\`.`, '',
    meta.styles === 'less' ? 'Every file uses Less variables, a parametric mixin, nested selectors and arithmetic. Pipelines: native = less-loader → native CSS; noop = less-loader → noop → native CSS; extract = less-loader → css-loader → CssExtractRspackPlugin. All Less groups execute less-loader; there is no loader-free Less group.' : 'Pipelines: native = native CSS; noop = noop → native CSS; extract = css-loader → CssExtractRspackPlugin.', '',
    `Node ${env.node}; ${env.platform} ${env.release} ${env.arch}; ${env.cpu}; logical CPUs ${env.logicalCpus}, available parallelism ${env.availableParallelism}.`, '',
    `Each group: one validation, one warmup, ${meta.runs} measured runs. Measurements rotate group order and execute serially.`, '',
    meta.conditions, '',
    '## Actual loaded packages', '',
    '| Group | Core | Binding | Native package | css-loader | less-loader | less |', '|---|---|---|---|---|---|---|'];
  for (const r of results.filter(r => r.phase === 'verify')) lines.push(
    `| ${r.topology}/${r.version}/${r.mode} | ${r.packageVersions.core} | ${r.packageVersions.binding} | ${r.packageVersions.nativeBindingName}@${r.packageVersions.nativeBinding} | ${r.packageVersions.cssLoader ?? '—'} | ${r.packageVersions.lessLoader ?? '—'} | ${r.packageVersions.less ?? '—'} |`);
  lines.push('', '## Validation', '', '| Group | CSS modules | Built style resources | noop calls | less-loader / Less compilations | importModule calls | Errors / warnings | CSS SHA-256 |',
    '|---|---:|---:|---:|---:|---:|---|---|');
  for (const r of results.filter(r => r.phase === 'verify')) lines.push(
    `| ${r.topology}/${r.version}/${r.mode} | ${r.validation.cssModuleCount} | ${r.validation.builtCssResources} | ${r.validation.noopCalls} | ${r.validation.lessLoaderCalls} / ${r.validation.lessCompiles} | ${r.validation.importModuleCalls} | 0 / 0 | ${r.validation.cssAssets['main.css'].sha256} |`);
  lines.push('', 'Native/noop CSS hashes are asserted equal within each version. Every emitted CSS selector and its declarations are checked, including expanded mixins and evaluated values. Measured outputs must match validation output. Less render calls and unique filenames are checked in validation only. Counters are absent from measured processes.', '');
  for (const suite of suites) {
    lines.push(`## ${suite.name}`, '', 'All values in milliseconds: median [min, max]. Warmups and validations excluded.', '',
      '| Version / mode | Build | make | finishMake | seal | emit | Process |', '|---|---:|---:|---:|---:|---:|---:|');
    for (const row of suite.rows) lines.push(`| ${row.version} / ${row.mode} | ` +
      ['buildMs', 'makeMs', 'finishMakeMs', 'sealMs', 'emitMs', 'processMs'].map(key => {
        const t = row.timings[key]; return `${fmt(t.median)} [${fmt(t.min)}, ${fmt(t.max)}]`;
      }).join(' | ') + ' |');
    lines.push('');
    for (const comparison of suite.comparisons) lines.push(
      `- ${comparison.mode}: 2.2.3 / 1.7.11 = **${comparison.v2OverV1.toFixed(3)}×**; obvious-regression gate ${comparison.obviousRegression ? 'met' : 'not met'}.`);
    if (suite.overheads) {
      lines.push('', '| Median difference (ms) | Build | make | finishMake | seal | emit | Process |', '|---|---:|---:|---:|---:|---:|---:|');
      for (const [label, item] of [['1.7.11: noop − native', suite.overheads.v1], ['2.2.3: noop − native', suite.overheads.v2],
        ['Difference of overheads: v2 − v1', suite.overheadDelta]]) lines.push(`| ${label} | ` +
          ['buildMs', 'makeMs', 'finishMakeMs', 'sealMs', 'emitMs', 'processMs'].map(key => fmt(item[key])).join(' | ') + ' |');
    }
    lines.push('');
  }
  lines.push('## Interpretation and timing boundaries', '',
    `Automatic supplement rule: ${meta.regressionRule}`, '',
    meta.styles === 'less' ? 'The native ratio compares less-loader plus native CSS across Rspack versions. Noop minus native estimates the cost of one additional noop loader after Less compilation; it does not estimate the cost of less-loader itself. Extraction always runs in auto mode to exercise the issue-related importModule path.' : 'The no-loader ratio probes base native-CSS builds. Within-version noop minus native estimates the net cost of introducing a JS loader; the difference between those overheads probes a change in that path.', '',
    'Negative differences can arise from noise or other pipeline effects. These aggregate differences do not isolate one function.', '',
    'The extraction suites exercise css-loader and each version’s CssExtractRspackPlugin (importModule is counted in validation), preceded by less-loader for Less inputs. They are reported separately from native CSS. Layered topology uses entry → sections → groups → original style files, with shared styles imported by all groups.', '',
    'A missing regression in this synthetic fixture does not disprove an issue in a real application. Five samples and min/max separation are descriptive evidence, not statistical significance. OS file caches remain warm; other machine activity is uncontrolled.', '');
  for (const [key, value] of Object.entries(meta.timingBoundaries)) lines.push(`- ${key}: ${value}.`);
  lines.push('', 'Stage medians need not sum to the build median. Initialization and gaps between hooks are included in build time; setup, close, stats, package loading and JSON IO are included in process time only.', '',
    'Raw samples/config/environment: `raw/`. Detailed post-timing stats: `stats/`. Worker logs: `logs/`. Exact job inputs: `jobs/`. CSS/JS outputs: `output/`. Full metric distributions and automatic decisions: `summary.json`. Input and script/lockfile hashes: `fixture.json`, `metadata.json`.', '');
  return lines.join('\n');
}
