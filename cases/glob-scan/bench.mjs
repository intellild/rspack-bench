import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repo = path.resolve(import.meta.dirname, '../..');
const entry = path.join(import.meta.dirname, 'project/index.js');
const query = '?glob-ab';

function prepareFixture(fixture) {
  const source = path.join(fixture, 'src');
  const expected = {};
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export default ' + JSON.stringify(value) + ';\n');
  };
  for (const [group, count] of [['packages', 96], ['plugins', 32]]) {
    for (let index = 0; index < count; index++) {
      const owner = (group === 'packages' && index % 4 === 0 ? 'disabled-' : 'active-')
        + String(index).padStart(3, '0');
      for (const file of ['index', 'about']) {
        const name = ['src', group, owner, 'pages', file + '.mjs'].join('/');
        const value = [group, owner, file].join('/');
        write(path.join(fixture, name), value);
        if (!(owner.startsWith('disabled-') && file === 'about')) expected['./' + name] = value;
      }
      for (let file = 0; file < 96; file++) {
        write(path.join(source, group, owner, 'pages', 'draft-' + file + '.mjs'), file);
      }
      for (let file = 0; file < 24; file++) {
        write(path.join(source, group, owner, 'assets/nested', 'asset-' + file + '.mjs'), file);
      }
    }
  }
  for (const directory of ['unrelated', 'docs']) {
    for (let sub = 0; sub < 16; sub++) {
      for (let file = 0; file < 96; file++) {
        write(path.join(source, directory, 'group-' + sub, 'fixture-' + file + '.mjs'), file);
      }
    }
  }
  fs.copyFileSync(entry, path.join(fixture, 'index.js'));
  fs.writeFileSync(path.join(fixture, 'expected.json'), JSON.stringify(expected));
}

async function compile(rspack, root, label, check) {
  const fixture = path.join(root, 'fixture');
  const source = path.join(fixture, 'src');
  const fixtureFilter = new RegExp(fixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const output = path.join(root, 'bundles', label);
  const counters = { stat: 0, lstat: 0, readdir: 0 };
  let afterResolve;
  let buildModule;
  let succeedModule;
  const isContextModule = (module) => {
    const id = module.identifier();
    return id.includes(query) && id.includes('|globImport:');
  };
  const compiler = rspack({
    context: fixture,
    entry: './index.js',
    mode: 'production',
    target: 'node',
    cache: false,
    devtool: false,
    optimization: { minimize: false },
    output: { path: output, filename: 'bundle.cjs' },
    ...(check ? { experiments: { useInputFileSystem: [fixtureFilter] } } : {}),
    plugins: [{
      apply(compiler) {
        compiler.hooks.contextModuleFactory.tap('GlobReleaseAB', (factory) => {
          factory.hooks.afterResolve.tap('GlobReleaseAB', (data) => {
            if (data !== false && data.request.includes(query)) {
              assert.equal(afterResolve, undefined, 'expected a single glob context');
              afterResolve = performance.now();
            }
          });
        });
        compiler.hooks.compilation.tap('GlobReleaseAB', (compilation) => {
          compilation.hooks.buildModule.tap('GlobReleaseAB', (module) => {
            if (isContextModule(module)) buildModule = performance.now();
          });
          compilation.hooks.succeedModule.tap('GlobReleaseAB', (module) => {
            if (isContextModule(module)) succeedModule = performance.now();
          });
        });
        if (check) {
          const original = compiler.inputFileSystem;
          const input = Object.create(original);
          for (const operation of ['stat', 'lstat', 'readdir']) {
            if (typeof original[operation] !== 'function') continue;
            input[operation] = (filename, ...args) => {
              if (afterResolve !== undefined && succeedModule === undefined
                  && filename.toString().startsWith(source + path.sep)) {
                counters[operation]++;
              }
              return original[operation](filename, ...args);
            };
          }
          compiler.inputFileSystem = input;
          compiler.hooks.beforeCompile.tap('GlobReleaseAB', () => {
            compiler.inputFileSystem = input;
          });
        }
      },
    }],
  });
  const start = performance.now();
  const stats = await new Promise((resolve, reject) => {
    compiler.run((err, stats) => err ? reject(err) : resolve(stats));
  });
  const wallMs = performance.now() - start;
  await new Promise((resolve, reject) => compiler.close((err) => err ? reject(err) : resolve()));
  assert.ok(stats);
  assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
  assert.ok(afterResolve !== undefined && buildModule !== undefined && succeedModule !== undefined,
    JSON.stringify({ afterResolve, buildModule, succeedModule }));
  assert.ok(afterResolve <= buildModule && buildModule <= succeedModule);

  const timing = { wallMs, contextMs: succeedModule - afterResolve, moduleBuildMs: succeedModule - buildModule };
  if (!check) return timing;
  createRequire(import.meta.url)(path.join(output, 'bundle.cjs'));
  const entries = Object.entries(globalThis.__globReleaseAB).sort(([a], [b]) => a.localeCompare(b));
  const expected = JSON.parse(fs.readFileSync(path.join(fixture, 'expected.json'), 'utf8'));
  assert.deepEqual(Object.fromEntries(entries), expected);
  return {
    ...timing, counters,
    outputCount: entries.length,
    outputDigest: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  };
}

async function serve(label, root, core) {
  const { rspack } = await import(pathToFileURL(core).href);
  process.on('message', async ({ id, check }) => {
    try {
      if (globalThis.gc) globalThis.gc();
      process.send({ id, result: await compile(rspack, root, label, check) });
    } catch (error) {
      process.send({ id, error: error.stack ?? String(error) });
    }
  });
  process.send({ ready: true });
}

function createWorker(label, root, core, binding) {
  const child = fork(fileURLToPath(import.meta.url), ['--worker', label, root, core], {
    cwd: root,
    env: {
      ...process.env,
      NAPI_RS_NATIVE_LIBRARY_PATH: binding,
      RSPACK_BINDING: '',
      RAYON_NUM_THREADS: '4',
      TOKIO_WORKER_THREADS: '4',
    },
    execArgv: ['--expose-gc'],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  let seq = 0;
  function reply(message) {
    return new Promise((resolve, reject) => {
      const onExit = (code, signal) => reject(new Error(label + ' exited (' + (code ?? signal) + ')'));
      const onMessage = (data) => {
        if (!message(data)) return;
        child.off('message', onMessage);
        child.off('exit', onExit);
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      child.on('message', onMessage);
      child.once('exit', onExit);
    });
  }
  return {
    child,
    ready: reply((message) => message.ready),
    async run(check = false) {
      const id = seq++;
      const promise = reply((message) => message.id === id);
      child.send({ id, check });
      return promise;
    },
  };
}

function summary(samples, field) {
  const ordered = samples.map((sample) => sample[field]).sort((a, b) => a - b);
  return {
    median: (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2,
    p25: ordered[Math.floor(ordered.length * 0.25)],
    p75: ordered[Math.floor(ordered.length * 0.75)],
  };
}

async function run(root, core, bindings, warmups, rounds) {
  prepareFixture(path.join(root, 'fixture'));
  const labels = ['handwritten', 'regex-automata'];
  const binarySizes = bindings.map((binding) => fs.statSync(binding).size);
  const workers = labels.map((label, index) => createWorker(label, root, core, bindings[index]));
  try {
    await Promise.all(workers.map((worker) => worker.ready));
    const checked = [];
    for (let index = 0; index < workers.length; index++) {
      checked.push(await workers[index].run(true));
      console.log(labels[index], checked[index]);
    }
    assert.equal(checked[0].outputCount, checked[1].outputCount);
    assert.equal(checked[0].outputDigest, checked[1].outputDigest);
    const samples = [[], []];
    for (let round = 0; round < warmups + rounds; round++) {
      for (const index of round % 2 === 0 ? [0, 1] : [1, 0]) {
        const sample = await workers[index].run();
        if (round >= warmups) samples[index].push(sample);
      }
    }
    const results = labels.map((label, index) => ({
      label,
      binding: path.basename(bindings[index]),
      binaryBytes: binarySizes[index],
      counts: checked[index].counters,
      outputCount: checked[index].outputCount,
      outputDigest: checked[index].outputDigest,
      wallMs: summary(samples[index], 'wallMs'),
      contextMs: summary(samples[index], 'contextMs'),
      moduleBuildMs: summary(samples[index], 'moduleBuildMs'),
      samples: samples[index],
    }));
    const report = path.join(root, 'benchmark.json');
    fs.writeFileSync(report, JSON.stringify({ rounds, warmups, results }, null, 2) + '\n');
    console.table(results.map(({ label, binaryBytes, counts, outputCount, wallMs, contextMs, moduleBuildMs }) => ({
      label, binaryBytes, ...counts, outputCount, wallMs: wallMs.median,
      contextMs: contextMs.median, moduleBuildMs: moduleBuildMs.median,
    })));
    console.log(`Results written to ${report}`);
  } finally {
    for (const { child } of workers) child.kill();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      core: { type: 'string' },
      warmups: { type: 'string', default: '6' },
      rounds: { type: 'string', default: '25' },
      help: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  const usage = 'node cases/glob-scan/bench.mjs --core <rspack-js-entry> [--warmups 6] [--rounds 25] <handwritten.node> <regex-automata.node>';
  if (values.help) {
    console.log(usage);
    return;
  }
  assert(values.core && positionals.length === 2, usage);
  const warmups = Number(values.warmups);
  const rounds = Number(values.rounds);
  assert(Number.isSafeInteger(warmups) && warmups >= 0, '--warmups must be a nonnegative integer');
  assert(Number.isSafeInteger(rounds) && rounds > 0, '--rounds must be a positive integer');

  const lock = path.join(repo, '.bench-running');
  fs.mkdirSync(lock);
  try {
    const results = path.join(repo, 'results');
    fs.mkdirSync(results, { recursive: true });
    const root = fs.mkdtempSync(path.join(results, 'glob-scan-'));
    await run(root, path.resolve(values.core), positionals.map((file) => path.resolve(file)), warmups, rounds);
  } finally {
    fs.rmdirSync(lock);
  }
}

if (process.argv[2] === '--worker') await serve(...process.argv.slice(3));
else await main();
