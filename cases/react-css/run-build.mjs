import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { componentDependencies } from './fixture.mjs';
import { validateCore, localRepository } from '../../versions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const job = JSON.parse(await readFile(process.argv[2], 'utf8'));
const req = createRequire(path.join(root, 'versions', job.version, 'package.json'));
const corePath = req.resolve('@rspack/core');
const coreReq = createRequire(corePath);
const rspack = req('@rspack/core');
const coreVersion = req('@rspack/core/package.json').version;
const bindingVersion = coreReq('@rspack/binding/package.json').version;
validateCore(job.version, req);
assert.equal(bindingVersion, coreVersion);
const nativeBindings = Object.keys(req.cache).filter(p => p.endsWith('.node') && p.includes('rspack'));
assert.equal(nativeBindings.length, 1, 'Exactly one native Rspack binding must be loaded');
const nativePackage = JSON.parse(await readFile(path.join(path.dirname(nativeBindings[0]), 'package.json')));
assert.equal(nativePackage.version, coreVersion);
let localBuild = null;
if (job.version === 'local') {
  const repository = localRepository();
  const bindingPath = await realpath(coreReq.resolve('@rspack/binding'));
  assert.equal(bindingPath, path.join(repository, 'crates/node_binding/binding.js'));
  assert.equal(await realpath(path.dirname(nativeBindings[0])), path.join(repository, 'crates/node_binding'),
    'Local group must load the locally compiled native binding, not a published fallback');
  localBuild = { repository, artifactHashes: {} };
  for (const filename of [corePath, bindingPath, nativeBindings[0]]) {
    localBuild.artifactHashes[filename] = createHash('sha256').update(await readFile(filename)).digest('hex');
  }
}
const fixture = fileURLToPath(new URL('./fixture/', import.meta.url));
const styleRoot = path.join(fixture, 'styles') + path.sep;
const componentRoot = path.join(fixture, 'components') + path.sep;
const noopPath = path.join(root, 'loaders/noop.cjs');
const isLess = job.styles === 'less';
const extension = isLess ? 'less' : 'css';
const lessLoaderPath = isLess ? req.resolve('less-loader') : null;
const lessPath = isLess ? req.resolve('less') : null;
const now = () => process.hrtime.bigint();
const elapsed = (a, b) => Number(b - a) / 1e6;
let noopCalls = 0;
let importModuleCalls = 0;
let lessLoaderCalls = 0;
let lessCompiles = 0;
const compiledLessResources = new Set();
const builtCssResources = new Set();
const lessThreadIds = new Set();
const marks = {};
if (job.verify && job.mode === 'noop') {
  const original = req(noopPath);
  req.cache[noopPath].exports = function (...args) {
    noopCalls++;
    return original.apply(this, args);
  };
}
if (job.verify && isLess && !job.case) {
  const originalLoader = req(lessLoaderPath);
  const countedLoader = function (...args) {
    lessLoaderCalls++;
    return originalLoader.apply(this, args);
  };
  Object.assign(countedLoader, originalLoader);
  countedLoader.default = countedLoader;
  req.cache[lessLoaderPath].exports = countedLoader;
  const less = req(lessPath);
  const originalRender = less.render;
  less.render = function (source, options, ...args) {
    lessCompiles++;
    compiledLessResources.add(options.filename);
    return originalRender.call(this, source, options, ...args);
  };
}

const timingPlugin = {
  apply(compiler) {
    const mark = (hook, name, stage = -1e9) => hook.tap({ name: 'BenchmarkClock', stage }, () => {
      assert.equal(marks[name], undefined, `Repeated timing hook: ${name}`);
      marks[name] = now();
    });
    mark(compiler.hooks.make, 'make');
    mark(compiler.hooks.finishMake, 'finishMake');
    mark(compiler.hooks.emit, 'emit');
    mark(compiler.hooks.afterEmit, 'afterEmit', 1e9);
    compiler.hooks.thisCompilation.tap('Benchmark', compilation => {
      mark(compilation.hooks.seal, 'seal');
      mark(compilation.hooks.afterSeal, 'afterSeal', 1e9);
      if (job.verify) {
        compilation.hooks.succeedModule.tap('VerifyCssBuilds', module => {
          if (module.resource?.startsWith(styleRoot)) builtCssResources.add(module.resource);
        });
        if (job.mode === 'extract') {
          rspack.NormalModule.getCompilationHooks(compilation).loader.tap('VerifyImportModule', context => {
            const original = context.importModule;
            context.importModule = function (...args) {
              importModuleCalls++;
              return original.apply(this, args);
            };
          });
        }
      }
    });
  },
};

const extract = job.mode === 'extract';
const config = {
  context: fixture,
  entry: job.topology === 'layered' ? './topology/index.js' : './index.js',
  mode: 'development',
  target: ['web', 'es2020'],
  devtool: false,
  cache: false,
  watch: false,
  profile: false,
  lazyCompilation: false,
  output: {
    path: job.output,
    filename: '[name].js',
    chunkFilename: '[name].js',
    cssFilename: '[name].css',
    cssChunkFilename: '[name].css',
    publicPath: '',
    uniqueName: 'rspack-css-bench',
    clean: false,
    pathinfo: false,
    library: { type: 'commonjs2' },
  },
  optimization: {
    minimize: false,
    minimizer: [],
    concatenateModules: false,
    splitChunks: false,
    runtimeChunk: false,
    // IDs are required to emit a working bundle; use basic sequential IDs.
    moduleIds: 'natural',
    chunkIds: 'natural',
    usedExports: false,
    sideEffects: false,
    providedExports: false,
    innerGraph: false,
    mangleExports: false,
    inlineExports: false,
    removeEmptyChunks: false,
    mergeDuplicateChunks: false,
    realContentHash: false,
    avoidEntryIife: false,
    nodeEnv: false,
    emitOnErrors: false,
  },
  module: {
    rules: [{
      test: isLess ? /\.less$/ : /\.css$/,
      type: extract ? 'javascript/auto' : 'css/module',
      ...(extract ? {
        use: [{ loader: rspack.CssExtractRspackPlugin.loader }, {
          loader: req.resolve('css-loader'),
          options: { modules: { localIdentName: 'scoped_[local]', namedExport: true, exportLocalsConvention: 'as-is' },
            import: false, url: false, sourceMap: false, esModule: true },
        }],
      } : {
        generator: { exportsOnly: false, esModule: true, localIdentName: 'scoped_[local]', exportsConvention: 'as-is' },
        use: job.mode === 'noop' ? [{ loader: noopPath }] : [],
      }),
    }],
  },
  experiments: {},
  plugins: [timingPlugin, ...(extract ? [new rspack.CssExtractRspackPlugin({
    filename: '[name].css', chunkFilename: '[name].css',
  })] : [])],
  stats: 'none',
  infrastructureLogging: { level: 'error' },
};
if (job.builtin) {
  assert(extract && isLess);
  config.module.rules[0].use.push({ loader: 'builtin:lightningcss-loader', options: { minify: false } });
}
if (isLess) {
  // Loaders run right-to-left: Less always compiles before noop or css-loader.
  config.module.rules[0].use.push({
    loader: lessLoaderPath,
    options: {
      implementation: lessPath,
      sourceMap: false,
      webpackImporter: true,
      lessOptions: { javascriptEnabled: false, math: 'parens-division' },
    },
  });
}
if (job.version === 'v1') {
  config.optimization.removeAvailableModules = false;
  config.experiments.cache = false;
  config.experiments.inlineConst = false;
  config.experiments.inlineEnum = false;
  config.experiments.parallelLoader = Boolean(job.lessParallel);
  config.experiments.css = !extract;
  config.experiments.incremental = false;
} else {
  config.experiments.newCache = false;
  config.experiments.pureFunctions = false;
  config.incremental = false;
}
for (const loader of config.module.rules[0].use) {
  loader.parallel = loader.loader === lessLoaderPath && Boolean(job.lessParallel);
}
config.module.rules.push({
  test: /\.jsx$/,
  type: 'javascript/auto',
  use: [{ loader: 'builtin:swc-loader', parallel: false, options: {
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2020',
      transform: { react: { runtime: 'automatic', development: true, refresh: false } } },
    minify: false,
    sourceMaps: false,
  } }],
});

const setupStart = now();
const compiler = rspack.rspack(config);
const compilerSetupMs = elapsed(setupStart, now());
// Check defaults did not re-enable any exposed optimization. Keep this outside
// the build timer and retain the effective options in every raw sample.
assert.equal(compiler.options.mode, 'development');
for (const [key, value] of Object.entries(compiler.options.optimization)) {
  if (key === 'moduleIds' || key === 'chunkIds') assert.equal(value, 'natural');
  else if (key === 'minimizer') assert.deepEqual(value, []);
  else assert.equal(value, false, `Optimization still enabled: ${key}`);
}
const effectiveConfig = {
  mode: compiler.options.mode,
  optimization: structuredClone(compiler.options.optimization),
  cache: compiler.options.cache,
  incremental: compiler.options.incremental ?? compiler.options.experiments.incremental,
  experiments: structuredClone(compiler.options.experiments),
};
let stats;
let buildMs;
try {
  const buildStart = now();
  stats = await new Promise((resolve, reject) => compiler.run((error, value) => {
    buildMs = elapsed(buildStart, now());
    error ? reject(error) : resolve(value);
  }));
} finally {
  await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
}
const statsStart = now();
const details = stats.toJson({ all: false, errors: true, errorDetails: true, warnings: true,
  assets: true, modules: true, nestedModules: true, cachedModules: true, children: true,
  source: false, modulesSpace: Infinity, assetsSpace: Infinity });
const statsMs = elapsed(statsStart, now());
await writeFile(job.statsFile, JSON.stringify(details, null, 2) + '\n');
assert.equal(details.errors?.length ?? 0, 0, JSON.stringify(details.errors));
assert.equal(details.warnings?.length ?? 0, 0, JSON.stringify(details.warnings));
const flatModules = [];
function visit(modules = []) {
  for (const module of modules) {
    flatModules.push(module);
    visit(module.modules);
  }
}
visit(details.modules);
const cssModules = flatModules.filter(module => module.moduleType === (extract ? 'css/mini-extract' : 'css/module'));
assert.equal(cssModules.length, job.modules, 'CSS module count in final stats');
const reactModules = flatModules.filter(module => module.identifier?.includes(componentRoot) && module.identifier.endsWith('.jsx'));
assert.equal(reactModules.length, job.modules, 'React component module count in final stats');
assert.equal(new Set(reactModules.map(module => module.identifier.split('!').at(-1))).size, job.modules);
for (const module of reactModules) assert(module.identifier.includes('builtin:swc-loader'));
if (job.case) {
  const styleModules = flatModules.filter(module => module.moduleType === 'javascript/auto'
    && module.identifier?.endsWith('.less') && module.identifier.includes(styleRoot));
  assert.equal(styleModules.length, job.modules);
  for (const module of styleModules) assert.equal(module.identifier.includes('builtin:lightningcss-loader'), job.builtin);
}
if (job.verify) {
  if (job.case) {
    const loaderResources = new Set();
    for (const file of await readdir(job.auditDir)) {
      const events = (await readFile(path.join(job.auditDir, file), 'utf8')).trim().split('\n').map(JSON.parse);
      for (const event of events) {
        assert.equal(event.threadId > 0, job.lessParallel, 'Less must execute on the configured thread');
        lessThreadIds.add(event.threadId);
        if (event.event === 'loader') { lessLoaderCalls++; loaderResources.add(event.filename); }
        else {
          assert.equal(event.event, 'render');
          lessCompiles++;
          compiledLessResources.add(event.filename);
        }
      }
    }
    assert.equal(loaderResources.size, job.modules);
  }
  assert.equal(builtCssResources.size, job.modules, 'Unique CSS resources observed in succeedModule');
  for (let i = 0; i < job.modules; i++) {
    const filename = path.join(styleRoot, `style-${String(i).padStart(5, '0')}.module.${extension}`);
    assert(builtCssResources.has(filename));
    if (isLess) assert(compiledLessResources.has(filename), `Less did not compile ${filename}`);
  }
  assert.equal(noopCalls, job.mode === 'noop' ? job.modules : 0, 'noop calls');
  assert.equal(importModuleCalls, extract ? job.modules : 0, 'importModule calls');
  assert.equal(lessLoaderCalls, isLess ? job.modules : 0, 'less-loader calls');
  assert.equal(lessCompiles, isLess ? job.modules : 0, 'Less render calls');
  assert.equal(compiledLessResources.size, isLess ? job.modules : 0, 'Unique compiled Less resources');
}
const cssAssets = {};
for (const asset of details.assets ?? []) {
  if (!asset.name?.endsWith('.css')) continue;
  const bytes = await readFile(path.join(job.output, asset.name));
  const text = bytes.toString();
  if (job.verify) {
    const classes = new Set([...text.matchAll(/\.scoped_bench_(\d+)\b/g)].map(match => Number(match[1])));
    assert.equal(classes.size, job.modules, 'All unique classes must be emitted');
    for (let i = 0; i < job.modules; i++) assert(classes.has(i), `Missing class ${i}`);
    // Inspect declarations, not just class names: uncompiled Less can retain its
    // class name while failing to expand variables, nested rules and mixins.
    const rules = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    assert.equal(rules.length, job.modules * 3, 'Three expanded CSS rules per file');
    const seenSelectors = new Set();
    for (const [, rawSelector, body] of rules) {
      const selector = rawSelector.trim().replace(/\s+/g, ' ');
      assert(!seenSelectors.has(selector), `Duplicate selector ${selector}`);
      seenSelectors.add(selector);
      assert.match(selector, /^\.scoped_bench_\d+(?::hover| > span)?$/);
      const expected = selector.endsWith(':hover') ? { color: '#654321', margin: '1px', padding: '0' }
        : selector.endsWith(' > span') ? { display: 'block', width: '10px', height: '10px' }
        : { color: '#123456', margin: '0', padding: '1px' };
      const declarations = body.split(';').map(s => s.trim()).filter(Boolean);
      assert.equal(declarations.length, 3);
      const actual = Object.fromEntries(declarations.map(s => s.split(':').map(part => part.trim())));
      assert.deepEqual(actual, expected, `Incorrect Less expansion for ${selector}`);
    }
    assert(!/@base|@hover|@gap|\.dimensions|&:hover/.test(text), 'Uncompiled Less in CSS output');
  }
  cssAssets[asset.name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
assert.deepEqual(Object.keys(cssAssets), ['main.css']);
let renderedComponents = null;
let componentReferences = null;
if (job.verify) {
  const module = { exports: {} };
  const runtimeMessages = [];
  const capture = (...args) => runtimeMessages.push(args.map(String).join(' '));
  runInNewContext(await readFile(path.join(job.output, 'main.js'), 'utf8'), {
    module, exports: module.exports, console: { ...console, warn: capture, error: capture },
    process: { env: { NODE_ENV: 'development' } },
  }, { filename: path.join(job.output, 'main.js'), timeout: 30000 });
  const { components } = module.exports;
  assert.equal(components.length, job.modules);
  assert.equal(new Set(components).size, job.modules);
  componentReferences = 0;
  for (let i = 0; i < job.modules; i++) {
    const element = components[i]({ depth: 1 });
    assert.equal(element.$$typeof, Symbol.for('react.transitional.element'));
    assert.equal(element.type, 'section');
    assert.equal(element.props['data-component'], i);
    assert.equal(element.props.className, `scoped_bench_${i}`, 'CSS Modules export must reach the React element');
    const children = [].concat(element.props.children);
    const references = children.filter(child => typeof child?.type === 'function');
    const expected = componentDependencies(i, job.modules);
    assert.equal(references.length, expected.length);
    references.forEach((child, index) => {
      assert.equal(child.type, components[expected[index]], 'Component dependency must resolve to its actual export');
      assert.equal(child.props.depth, 0);
      componentReferences++;
    });
  }
  assert.deepEqual(runtimeMessages, [], 'React runtime warnings or errors');
  renderedComponents = components.length;
}
for (const key of ['make', 'finishMake', 'seal', 'afterSeal', 'emit', 'afterEmit']) assert(marks[key], `Missing ${key}`);
const stages = {
  makeMs: elapsed(marks.make, marks.finishMake),
  finishMakeMs: elapsed(marks.finishMake, marks.seal),
  sealMs: elapsed(marks.seal, marks.afterSeal),
  emitMs: elapsed(marks.emit, marks.afterEmit),
};
for (const value of Object.values(stages)) assert(value >= 0 && value <= buildMs);
const configRecord = { ...config,
  module: { ...config.module, rules: config.module.rules.map(rule => ({ ...rule, test: rule.test.toString() })) },
  plugins: config.plugins.map(plugin => plugin === timingPlugin ? 'BenchmarkClock' : 'CssExtractRspackPlugin'),
};
const result = {
  ...job,
  packageVersions: { core: coreVersion, binding: bindingVersion, nativeBinding: nativePackage.version,
    compiledCore: rspack.rspackVersion,
    nativeBindingName: nativePackage.name, cssLoader: extract ? req('css-loader/package.json').version : null,
    lessLoader: isLess ? req('less-loader/package.json').version : null,
    less: isLess ? req(lessPath).version.join('.') : null, react: req('react/package.json').version },
  loadedPaths: { core: corePath, binding: coreReq.resolve('@rspack/binding'), nativeBinding: nativeBindings[0],
    ...(isLess ? { lessLoader: lessLoaderPath, less: lessPath } : {}) },
  localBuild,
  environment: { node: process.version, execPath: process.execPath, platform: os.platform(),
    release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
    availableParallelism: os.availableParallelism(), totalMemoryBytes: os.totalmem(),
    loadAverage: os.loadavg(), execArgv: process.execArgv,
    env: Object.fromEntries(['NODE_OPTIONS', 'RAYON_NUM_THREADS', 'UV_THREADPOOL_SIZE', 'RSPACK_NUM_THREADS']
      .concat(['RSPACK_LOADER_WORKER_THREADS']).map(key => [key, process.env[key] ?? null])) },
  timings: { buildMs, ...stages, compilerSetupMs, statsMs },
  validation: { cssModuleCount: cssModules.length, builtCssResources: job.verify ? builtCssResources.size : null,
    reactModuleCount: reactModules.length, renderedComponents, componentReferences,
    noopCalls: job.verify ? noopCalls : null, importModuleCalls: job.verify ? importModuleCalls : null,
    lessLoaderCalls: job.verify ? lessLoaderCalls : null, lessCompiles: job.verify ? lessCompiles : null,
    compiledLessResources: job.verify ? compiledLessResources.size : null,
    lessThreadIds: job.verify && job.case ? [...lessThreadIds].sort((a, b) => a - b) : null,
    errors: 0, warnings: 0, cssAssets },
  config: configRecord,
  effectiveConfig,
};
if (isLess) {
  if (!job.lessParallel) assert(req.cache[lessLoaderPath], 'Configured less-loader was not loaded');
  assert(req.cache[lessPath], 'Configured Less implementation was not loaded');
  assert.equal(result.packageVersions.lessLoader, '13.0.0');
  assert.equal(result.packageVersions.less, '4.9.1');
}
await writeFile(job.resultFile, JSON.stringify(result, null, 2) + '\n');
console.log(`${job.id}: core=${coreVersion} binding=${bindingVersion} native=${nativePackage.version} build=${buildMs.toFixed(2)}ms`);
