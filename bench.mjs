#!/usr/bin/env zx
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateFixture, fingerprintFixture } from './fixture.mjs';
import { availableVersions, validateCore } from './versions.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const scriptIndex = process.argv.findIndex((arg, index) => index > 0 && path.resolve(arg) === fileURLToPath(import.meta.url));
assert(scriptIndex > 0, 'Cannot locate benchmark script in argv');
const { values } = parseArgs({ args: process.argv.slice(scriptIndex + 1), options: {
  versions: { type: 'string', default: availableVersions.join(',') },
  modules: { type: 'string', default: '10000' },
  runs: { type: 'string', default: '5' },
  supplement: { type: 'string', default: 'auto' },
  styles: { type: 'string', default: 'less' },
  experiment: { type: 'string', default: 'baseline' },
  'generate-only': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
}, strict: true });
if (values.help) {
  console.log('pnpm bench [--versions v1,v2,local] [--modules 10000] [--runs 5] [--styles less|css] [--supplement auto|always|never] [--experiment baseline|mixed] [--generate-only]');
  process.exit(0);
}
const versions = values.versions.split(',');
assert(versions.length > 0 && versions.every(version => availableVersions.includes(version)), 'Invalid --versions');
assert.equal(new Set(versions).size, versions.length, 'Duplicate --versions');
const modules = Number(values.modules);
const runs = Number(values.runs);
assert(Number.isSafeInteger(modules) && modules > 0, '--modules must be a positive integer');
assert(Number.isSafeInteger(runs) && runs > 0, '--runs must be a positive integer');
assert(['auto', 'always', 'never'].includes(values.supplement), 'Invalid --supplement');
assert(['less', 'css'].includes(values.styles), 'Invalid --styles');
assert(['baseline', 'mixed'].includes(values.experiment), 'Invalid --experiment');
assert(values.experiment !== 'mixed' || values.styles === 'less', 'Mixed experiment requires Less');
const caseName = group => group.case ?? group.mode;
const sameGroup = (a, b) => a.version === b.version && a.topology === b.topology && caseName(a) === caseName(b);
const req = createRequire(import.meta.url);
assert.equal(req('zx/package.json').version, '8.8.5');
assert.equal(req('react/package.json').version, '19.1.0');
for (const version of versions) {
  const versionReq = createRequire(path.join(root, 'versions', version, 'package.json'));
  validateCore(version, versionReq);
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
  if (values['generate-only']) {
    const fixture = await generateFixture({ modules, styles: values.styles });
    console.log(`Generated ${modules} React components and CSS Modules files in fixture/. SHA-256: ${fixture.sha256}`);
    return;
  }
  const session = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-') + `-${process.pid}`;
  const resultDir = path.join(root, 'results', session);
  for (const dir of ['raw', 'stats', 'jobs', 'logs', 'output']) await mkdir(path.join(resultDir, dir), { recursive: true });
  console.log(`Results: ${resultDir}`);
  console.log(`Node ${process.version}; ${os.platform()} ${os.release()} ${os.arch()}; CPU ${os.cpus()[0]?.model}; logical=${os.cpus().length}, available=${os.availableParallelism()}`);
  console.log('Generating shared React + CSS Modules fixture (outside timers)…');
  const fixture = await generateFixture({ modules, styles: values.styles });
  await writeJson(path.join(resultDir, 'fixture.json'), fixture);
  const metadata = {
    session, modules, runs, versions, styles: values.styles, experiment: values.experiment, warmupsPerGroup: 1, supplement: values.supplement,
    startedAt: new Date().toISOString(), fixtureSha256: fixture.sha256,
    regressionRule: 'At least 10% slower median build, and candidate minimum > baseline maximum. Descriptive gate, not a significance test.',
    timingBoundaries: { buildMs: 'compiler.run invocation → callback (excludes compiler setup/close and stats)',
      makeMs: 'compiler.make (early) → compiler.finishMake (early)',
      finishMakeMs: 'compiler.finishMake (early) → compilation.seal (early); includes module graph finishing',
      sealMs: 'compilation.seal (early) → compilation.afterSeal (late)',
      emitMs: 'compiler.emit (early) → compiler.afterEmit (late)',
      processMs: 'parent spawn → child exit, including startup, package load, setup/close, stats and JSON IO' },
    conditions: 'Development mode; all exposed optimization switches disabled and checked against compiler.options; natural module/chunk IDs; serial fresh Node processes; cache/incremental disabled; no OS file cache flush; no per-module instrumentation outside validation.',
    artifactHashes: {},
  };
  for (const name of ['bench.mjs', 'fixture.mjs', 'versions.mjs', 'run-build.mjs', 'loaders/noop.cjs', 'loaders/verify-less.cjs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    ...versions.map(version => `versions/${version}/package.json`)]) {
    metadata.artifactHashes[name] = hash(await readFile(path.join(root, name)));
  }
  await writeJson(path.join(resultDir, 'metadata.json'), metadata);
  const allResults = [];
  const suites = [];
  async function execute(group, phase, round) {
    const id = `${values.styles}-${group.topology}-${group.version}-${caseName(group)}-${phase}-${round}`;
    const job = { ...group, id, phase, round, modules, styles: values.styles, verify: phase === 'verify',
      fixtureSha256: fixture.sha256,
      output: path.join(resultDir, 'output', id),
      statsFile: path.join(resultDir, 'stats', `${id}.json`),
      resultFile: path.join(resultDir, 'raw', `${id}.json`) };
    await mkdir(job.output);
    if (job.verify && job.case) {
      job.auditDir = path.join(resultDir, 'validation', id);
      await mkdir(job.auditDir, { recursive: true });
    }
    const jobFile = path.join(resultDir, 'jobs', `${id}.json`);
    await writeJson(jobFile, job);
    const child = await runWorker(jobFile, job);
    const processMs = child.processMs;
    await writeFile(path.join(resultDir, 'logs', `${id}.log`), child.stdout + child.stderr);
    assert.equal(child.exitCode, 0, `Build failed: ${id}\n${child.stdout}\n${child.stderr}`);
    assert.equal(child.stderr.trim(), '', `Unexpected process warning: ${child.stderr}`);
    const result = JSON.parse(await readFile(job.resultFile, 'utf8'));
    if (group.version === 'local') {
      const reference = allResults.find(r => r.version === 'local');
      if (reference) {
        assert.deepEqual(result.localBuild, reference.localBuild, 'Local build artifacts changed during the benchmark');
        assert.equal(result.packageVersions.compiledCore, reference.packageVersions.compiledCore);
      }
    }
    result.timings.processMs = processMs;
    result.executionOrder = allResults.length;
    await writeJson(job.resultFile, result);
    allResults.push(result);
    console.log(`${id}: core=${result.packageVersions.core} compiled=${result.packageVersions.compiledCore} binding=${result.packageVersions.binding} native=${result.packageVersions.nativeBinding} less-loader=${result.packageVersions.lessLoader ?? 'none'} less=${result.packageVersions.less ?? 'none'} build=${result.timings.buildMs.toFixed(2)}ms process=${processMs.toFixed(2)}ms`);
    return result;
  }
  async function suite(name, groups) {
    const validation = [];
    for (const group of groups) validation.push(await execute(group, 'verify', 0));
    for (const version of versions) {
      const native = validation.find(r => r.version === version && r.mode === 'native');
      const noop = validation.find(r => r.version === version && r.mode === 'noop');
      if (native && noop) assert.deepEqual(native.validation.cssAssets, noop.validation.cssAssets,
        `${version}: native and noop CSS output must be byte-identical`);
    }
    if (values.experiment === 'mixed') {
      for (const builtin of [false, true]) {
        const matching = validation.filter(r => r.builtin === builtin);
        for (const result of matching) assert.deepEqual(result.validation.cssAssets, matching[0].validation.cssAssets,
          'Versions and parallel settings must emit identical CSS for the same pipeline');
      }
    }
    // Every group gets exactly one warmup before any measured run in this suite.
    for (const group of groups) await execute(group, 'warmup', 0);
    for (let round = 1; round <= runs; round++) {
      // Rotate the order to distribute position effects, while staying fully serial.
      const offset = (round - 1) % groups.length;
      const order = [...groups.slice(offset), ...groups.slice(0, offset)];
      for (const group of order) {
        const result = await execute(group, 'measure', round);
        const reference = validation.find(r => sameGroup(r, group));
        assert.deepEqual(result.validation.cssAssets, reference.validation.cssAssets, 'Output changed across runs');
      }
    }
    const measured = allResults.filter(r => r.phase === 'measure' && groups.some(g =>
      sameGroup(g, r)));
    const summary = summarize(name, groups, measured);
    suites.push(summary);
    await saveReport();
    return summary;
  }
  if (values.experiment === 'mixed') {
    await suite('mixed-flat', [false, true].flatMap(builtin => [false, true].flatMap(lessParallel =>
      versions.map(version => ({ version, mode: 'extract', topology: 'flat', builtin, lessParallel,
        case: `${builtin ? 'builtin' : 'no-builtin'}-${lessParallel ? 'parallel' : 'serial'}` })))));
  } else {
    const primary = await suite(`native-${values.styles}`, ['native', 'noop'].flatMap(mode =>
      versions.map(version => ({ version, mode, topology: 'flat' }))));
    if (values.supplement === 'always' || (values.supplement === 'auto' && (values.styles === 'less' || !primary.obviousRegression))) {
      console.log('Running separate css-loader + CssExtractRspackPlugin comparison.');
      const extract = await suite('extract-flat', versions.map(version => ({ version, mode: 'extract', topology: 'flat' })));
      if (values.supplement === 'always' || !extract.obviousRegression) {
        console.log('Running layered JS imports and shared React component comparison.');
        await suite('extract-layered', versions.map(version => ({ version, mode: 'extract', topology: 'layered' })));
      }
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

function runWorker(jobFile, job) {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const preload = job.verify && job.case;
    const child = spawn(process.execPath, [...(preload ? ['--require', path.join(root, 'loaders/verify-less.cjs')] : []),
      path.join(root, 'run-build.mjs'), jobFile], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(preload ? { RSPACK_BENCH_VERIFY_JOB: jobFile } : {}) },
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
    const samples = results.filter(r => sameGroup(r, group));
    assert.equal(samples.length, runs);
    return { ...group, timings: Object.fromEntries(Object.keys(samples[0].timings).map(key =>
      [key, distribution(samples.map(s => s.timings[key]))])) };
  });
  const pairs = versions.flatMap((baseline, index) => versions.slice(index + 1).map(target => ({ baseline, target })));
  const comparisons = [...new Set(groups.map(caseName))].flatMap(mode => pairs.map(({ baseline, target }) => {
    const base = rows.find(r => r.version === baseline && caseName(r) === mode).timings.buildMs;
    const candidate = rows.find(r => r.version === target && caseName(r) === mode).timings.buildMs;
    const ratio = candidate.median / base.median;
    return { mode, baseline, target, ratio, obviousRegression: ratio >= 1.1 && candidate.min > base.max };
  }));
  const overheads = name.startsWith('native-') ? Object.fromEntries(versions.map(version => {
    const native = rows.find(r => r.version === version && r.mode === 'native').timings;
    const noop = rows.find(r => r.version === version && r.mode === 'noop').timings;
    return [version, Object.fromEntries(Object.keys(native).map(key => [key, noop[key].median - native[key].median]))];
  })) : null;
  const overheadDeltas = overheads ? pairs.map(({ baseline, target }) => ({ baseline, target,
    timings: Object.fromEntries(Object.keys(overheads[baseline]).map(key => [key, overheads[target][key] - overheads[baseline][key]])),
  })) : [];
  return { name, rows, comparisons, overheads, overheadDeltas,
    obviousRegression: comparisons.some(c => c.obviousRegression) };
}

function renderReport(meta, suites, results) {
  if (meta.experiment === 'mixed') return renderMixedReport(meta, suites, results);
  const env = results[0].environment;
  const fmt = number => number.toFixed(2);
  const lines = [`# Rspack ${meta.styles.toUpperCase()} benchmark`, '',
    `Session: ${meta.session}. Status: ${meta.finishedAt ? 'complete' : 'in progress'}.`, '',
    `Fixture: ${meta.modules} dependent React components, each importing one .module.${meta.styles} file, producing 3 CSS rules × 3 declarations per file. SHA-256: \`${meta.fixtureSha256}\`.`, '',
    meta.styles === 'less' ? 'Every file uses Less variables, a parametric mixin, nested selectors and arithmetic. Pipelines: native = less-loader → native CSS; noop = less-loader → noop → native CSS; extract = less-loader → css-loader → CssExtractRspackPlugin. All Less groups execute less-loader; there is no loader-free Less group.' : 'Pipelines: native = native CSS; noop = noop → native CSS; extract = css-loader → CssExtractRspackPlugin.', '',
    `Node ${env.node}; ${env.platform} ${env.release} ${env.arch}; ${env.cpu}; logical CPUs ${env.logicalCpus}, available parallelism ${env.availableParallelism}.`, '',
    `Each group: one validation, one warmup, ${meta.runs} measured runs. Measurements rotate group order and execute serially.`, '',
    meta.conditions, '',
    'Version identifiers distinguish published packages (v1/v2) from local build artifacts (local). Compiled core versions are read from the loaded API; package versions can differ for an existing local build. Local core/binding paths and artifact hashes are retained in raw/.', '',
    'React 19.1.0; all JSX compiled by builtin:swc-loader. Each component consumes a scoped CSS Modules class. Validation evaluates the emitted bundle, calls every component, and checks its styles and component references.\n\n## Actual loaded packages', '',
    '| Group | Core package | Compiled core | Binding | Native package | css-loader | less-loader | less |', '|---|---|---|---|---|---|---|---|'];
  for (const r of results.filter(r => r.phase === 'verify')) lines.push(
    `| ${r.topology}/${r.version}/${r.mode} | ${r.packageVersions.core} | ${r.packageVersions.compiledCore} | ${r.packageVersions.binding} | ${r.packageVersions.nativeBindingName}@${r.packageVersions.nativeBinding} | ${r.packageVersions.cssLoader ?? '—'} | ${r.packageVersions.lessLoader ?? '—'} | ${r.packageVersions.less ?? '—'} |`);
  lines.push('', '## Validation', '', '| Group | React modules / rendered | Component references | CSS modules | Built style resources | noop calls | less-loader / Less compilations | importModule calls | Errors / warnings | CSS SHA-256 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|---|');
  for (const r of results.filter(r => r.phase === 'verify')) lines.push(
    `| ${r.topology}/${r.version}/${r.mode} | ${r.validation.reactModuleCount} / ${r.validation.renderedComponents} | ${r.validation.componentReferences} | ${r.validation.cssModuleCount} | ${r.validation.builtCssResources} | ${r.validation.noopCalls} | ${r.validation.lessLoaderCalls} / ${r.validation.lessCompiles} | ${r.validation.importModuleCalls} | 0 / 0 | ${r.validation.cssAssets['main.css'].sha256} |`);
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
      `- ${comparison.mode}: ${comparison.target} / ${comparison.baseline} = **${comparison.ratio.toFixed(3)}×**; obvious-regression gate ${comparison.obviousRegression ? 'met' : 'not met'}.`);
    if (suite.overheads) {
      lines.push('', '| Median difference (ms) | Build | make | finishMake | seal | emit | Process |', '|---|---:|---:|---:|---:|---:|---:|');
      for (const [label, item] of [...Object.entries(suite.overheads).map(([version, timings]) => [`${version}: noop − native`, timings]),
        ...suite.overheadDeltas.map(item => [`Difference of overheads: ${item.target} − ${item.baseline}`, item.timings])]) lines.push(`| ${label} | ` +
          ['buildMs', 'makeMs', 'finishMakeMs', 'sealMs', 'emitMs', 'processMs'].map(key => fmt(item[key])).join(' | ') + ' |');
    }
    lines.push('');
  }
  lines.push('## Interpretation and timing boundaries', '',
    `Automatic supplement rule: ${meta.regressionRule}`, '',
    meta.styles === 'less' ? 'The native ratio compares less-loader plus native CSS across Rspack versions. Noop minus native estimates the cost of one additional noop loader after Less compilation; it does not estimate the cost of less-loader itself. Extraction always runs in auto mode to exercise the issue-related importModule path.' : 'The native CSS ratio includes the shared React/SWC graph. Within-version noop minus native estimates the net cost of introducing a JS loader; the difference between those overheads probes a change in that path.', '',
    'Negative differences can arise from noise or other pipeline effects. These aggregate differences do not isolate one function.', '',
    'The extraction suites exercise css-loader and each version’s CssExtractRspackPlugin (importModule is counted in validation), preceded by less-loader for Less inputs. They are reported separately from native CSS. Layered topology uses entry → sections → groups → React components → CSS Modules, with shared components imported by all groups.', '',
    'A missing regression in this synthetic fixture does not disprove an issue in a real application. Five samples and min/max separation are descriptive evidence, not statistical significance. OS file caches remain warm; other machine activity is uncontrolled.', '');
  for (const [key, value] of Object.entries(meta.timingBoundaries)) lines.push(`- ${key}: ${value}.`);
  lines.push('', 'Stage medians need not sum to the build median. Initialization and gaps between hooks are included in build time; setup, close, stats, package loading and JSON IO are included in process time only.', '',
    'Raw samples/config/environment: `raw/`. Detailed post-timing stats: `stats/`. Worker logs: `logs/`. Exact job inputs: `jobs/`. CSS/JS outputs: `output/`. Full metric distributions and automatic decisions: `summary.json`. Input and script/lockfile hashes: `fixture.json`, `metadata.json`.', '');
  return lines.join('\n');
}

function renderMixedReport(meta, suites, results) {
  const lines = ['# Mixed Less / builtin Lightning CSS benchmark', '',
    `Session: ${meta.session}. Status: ${meta.finishedAt ? 'complete' : 'in progress'}.`, '',
    `${meta.modules} dependent React components with one Less CSS Module each; one validation, one warmup and ${meta.runs} measured fresh processes per group. Flat component entry imports; JSX compiled by builtin:swc-loader.`, '',
    'Execution: less-loader → optional builtin:lightningcss-loader → css-loader → CssExtractRspackPlugin. Module type: javascript/auto. Lightning CSS minify: false. Only less-loader varies parallel: false/true; all other loader parallel flags remain false. Rspack 1.x additionally enables experiments.parallelLoader for parallel groups.', '',
    meta.conditions, '',
    'Version identifiers distinguish published packages (v1/v2) from local build artifacts (local). Compiled core versions are read from the loaded API; package versions can differ for an existing local build. Local core/binding paths and artifact hashes are retained in raw/.', '',
    `Fixture SHA-256: \`${meta.fixtureSha256}\`.`, '',
    'Validation preloads counters in the main thread and loader workers without replacing configured loader paths. It checks every Less loader/render call and resource, execution thread, extraction importModule calls, React and CSS module counts, and every emitted selector/declaration. It also evaluates the bundle and verifies every component’s CSS Modules binding and component references. Measured processes have no preload or counters. CSS hashes must match across parallel settings and versions for each pipeline, and across repeated builds.', '',
    '| Version / case | React modules / rendered | Component references | Less calls / renders | Thread IDs | importModule calls | CSS modules |',
    '|---|---:|---:|---:|---|---:|---:|'];
  for (const r of results.filter(r => r.verify)) lines.push(
    `| ${r.version} (compiled ${r.packageVersions.compiledCore}, package ${r.packageVersions.core}) / ${r.case} | ${r.validation.reactModuleCount} / ${r.validation.renderedComponents} | ${r.validation.componentReferences} | ${r.validation.lessLoaderCalls} / ${r.validation.lessCompiles} | ${r.validation.lessThreadIds.join(', ')} | ${r.validation.importModuleCalls} | ${r.validation.cssModuleCount} |`);
  for (const suite of suites) {
    lines.push('', 'All times in milliseconds: median [min, max].', '',
      '| Version / case | Build | make | finishMake | seal | Process |', '|---|---:|---:|---:|---:|---:|');
    for (const row of suite.rows) lines.push(`| ${row.version} / ${row.case} | ` +
      ['buildMs', 'makeMs', 'finishMakeMs', 'sealMs', 'processMs'].map(key => {
        const t = row.timings[key]; return `${t.median.toFixed(2)} [${t.min.toFixed(2)}, ${t.max.toFixed(2)}]`;
      }).join(' | ') + ' |');
    lines.push('');
    for (const c of suite.comparisons) lines.push(`- ${c.mode}: ${c.target} / ${c.baseline} = ${c.ratio.toFixed(3)}×; regression gate ${c.obviousRegression ? 'met' : 'not met'}.`);
    lines.push('', '| Version | Builtin cost, serial Less | Builtin cost, parallel Less | Difference of builtin costs |', '|---|---:|---:|---:|');
    for (const version of versions) {
      const median = (builtin, lessParallel) => suite.rows.find(r => r.version === version && r.builtin === builtin && r.lessParallel === lessParallel).timings.buildMs.median;
      const serial = median(true, false) - median(false, false);
      const parallel = median(true, true) - median(false, true);
      lines.push(`| ${version} | ${serial.toFixed(2)} | ${parallel.toFixed(2)} | ${(parallel - serial).toFixed(2)} |`);
    }
  }
  lines.push('', `Regression gate: ${meta.regressionRule}`, '',
    'Differences compare whole builds and do not isolate an internal function. Worker startup is included. OS caches remain warm; other machine activity is uncontrolled. A synthetic fixture cannot rule out application-specific regressions.', '',
    'Dependencies, environment, effective configuration and samples: raw/. Detailed module identifiers: stats/. Per-thread validation journals: validation/. Input/script/lock hashes: fixture.json and metadata.json.', '');
  for (const [key, value] of Object.entries(meta.timingBoundaries)) lines.push(`- ${key}: ${value}.`);
  return lines.join('\n') + '\n';
}
