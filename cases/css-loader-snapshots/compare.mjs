#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

async function main() {
  const { values: args } = parseArgs({ options: {
    rspack: { type: 'string' }, out: { type: 'string' },
    'fail-on-diff': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (args.help) {
    console.log(`Usage: node cases/css-loader-snapshots/compare.mjs --rspack /path/to/rspack [--out directory] [--fail-on-diff]

  Only tests/rspack-test/configCases/css/css-loader is used.
  Reads the existing fixtures/config/snapshots without modifying them.
  Uses css-loader and the built @rspack/core from that checkout (no downloads).
  Every existing snapshot gets snapshots/<filename>.diff, including equal/error cases.
  Each imported fixture also gets css/<name>/{native,css-loader}.css and raw/normalized diffs.
  Raw diffs retain all differences. Normalized diffs remove comments/formatting, simple quote
  style differences, and only the configured hash suffix of generated local identifiers.
  Class snapshots are compared with css-loader's locals (excluding default, as in the fixture).
  The four native export modes share one css-loader array/locals build: DOM injection and
  CSSStyleSheet behavior are not emulated. This is a CSS/locals comparison, not the test harness.
  Exit: 0 = report generated; 1 = differences with --fail-on-diff; 2 = build/execution/report error.
  Default output: rspack-bench/results/css-loader-snapshots/<timestamp>.`);
    process.exit(0);
  }
  const fixtureRelative = 'tests/rspack-test/configCases/css/css-loader';
  async function findRspack() {
    const candidates = [args.rspack, process.env.RSPACK_ROOT, process.cwd(),
      path.join(os.homedir(), 'rstack/rspack'), path.join(os.homedir(), 'projects/rspack')].filter(Boolean);
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      try { await fs.access(path.join(resolved, fixtureRelative, 'rspack.config.mjs')); return resolved; }
      catch { if (args.rspack) throw new Error(`Missing ${fixtureRelative} in ${resolved}`); }
    }
    throw new Error('Specify a built Rspack checkout with --rspack.');
  }
  const root = await findRspack();
  const fixture = path.join(root, fixtureRelative);
  const out = path.resolve(args.out ?? path.join(import.meta.dirname, '../../results/css-loader-snapshots',
    new Date().toISOString().replaceAll(':', '-')));
  // Never clean or overwrite an earlier run, or write into the source checkout.
  if (out === root || out.startsWith(root + path.sep)) throw new Error('--out must be outside the Rspack checkout');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.mkdir(out);
  const testRequire = createRequire(path.join(root, 'tests/rspack-test/package.json'));
  const toolsRequire = createRequire(path.join(root, 'packages/rspack-test-tools/package.json'));
  const cssLoader = testRequire.resolve('css-loader');
  const cssRequire = createRequire(cssLoader);
  const { rspack } = await import(pathToFileURL(path.join(root, 'packages/rspack/dist/index.js')));
  const { format } = toolsRequire('pretty-format');
  const { createSnapshotSerializer } = toolsRequire('path-serializer');
  const placeholderSerializer = createSnapshotSerializer({ root, replace: [
    { match: path.join(root, 'packages/rspack-test-tools'), mark: 'test_tools_root' },
    { match: path.join(root, 'tests/rspack-test'), mark: 'test_root' },
    { match: path.join(root, 'packages/rspack'), mark: 'rspack_root' },
    { match: /:\d+:\d+-\d+:\d+/g, mark: 'line_col_range' },
    { match: /:\d+:\d+/g, mark: 'line_col' },
  ], features: { replaceWorkspace: false, addDoubleQuotes: false, escapeDoubleQuotes: false } });
  const { diffLinesUnified } = toolsRequire('jest-diff');
  const postcss = cssRequire('postcss');
  const valueParser = cssRequire('postcss-value-parser');
  const selectorParser = cssRequire('postcss-selector-parser');
  const cssesc = cssRequire('cssesc');
  const configs = (await import(pathToFileURL(path.join(fixture, 'rspack.config.mjs')))).default;
  const textConfig = configs.find(config => config.name === 'text');
  if (!textConfig) throw new Error('The css-loader fixture has no text config.');
  const source = await fs.readFile(path.join(fixture, 'index.js'), 'utf8');
  const imports = [...source.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["']/g)]
    .map(([, name, request]) => ({ name, request }));
  if (!imports.length) throw new Error('No CSS namespace imports found in the fixture entry.');
  const entries = Object.fromEntries(imports.map(({ name, request }) => [name, request]));
  const snapshots = (await fs.readdir(path.join(fixture, '__snapshot__'))).filter(name => name.endsWith('.txt')).sort();
  const serialize = value => format(value, { escapeRegex: true, printFunctionName: false,
    plugins: [{ test: val => typeof val === 'string', print: val => placeholderSerializer.serialize(val.trim()) }] });
  const withoutDefault = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'default'));
  const write = async (file, value) => {
    const dest = path.join(out, file);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  };
  function diff(expected, actual, a = 'rspack', b = 'css-loader') {
    if (expected === actual) return '# Identical\n';
    return diffLinesUnified(expected.split('\n'), actual.split('\n'), {
      aAnnotation: a, bAnnotation: b, expand: false, contextLines: 3,
      aColor: x => x, bColor: x => x, commonColor: x => x, patchColor: x => x,
    }) + '\n';
  }
  function normalizeHash(value, request) {
    const query = request?.slice(request.indexOf('?'));
    const generator = customRules.find(rule => rule.resourceQuery.test(query))?.generator;
    if (!generator?.localIdentName?.includes('[fullhash]')) return value;
    const suffix = generator.localIdentName.split('[fullhash]')[1];
    const length = generator.localIdentHashDigestLength ?? 6;
    if (!value.endsWith(suffix)) return value;
    const end = value.length - suffix.length, start = end - length;
    // The fixture's hashed templates put the hash after -- or ---. Restrict
    // normalization to that exact slot; never replace arbitrary CSS numbers.
    if (!value.slice(0, start).endsWith('--') || !/^[a-zA-Z0-9+/_-]+$/.test(value.slice(start, end))) return value;
    return value.slice(0, start) + 'HASH' + suffix;
  }
  function normalizeValue(value, identifiers) {
    const ast = valueParser(value);
    ast.walk(node => {
      if (node.type === 'string' || node.type === 'word') node.value = identifiers.get(node.value) ?? node.value;
      if (node.type === 'string' && !node.value.includes('\\')) {
        node.quote = '"';
        node.value = node.value.replace(/"/g, '\\"');
      } else if (node.type === 'space') {
        node.value = ' ';
      }
    });
    return ast.toString();
  }
  function normalizeCss(css, request, locals) {
    const identifiers = new Map(Object.values(locals).map(value => [value, normalizeHash(value, request)]));
    function visit(node) {
      if (node.type === 'comment') return [];
      let line;
      if (node.type === 'rule') {
        line = selectorParser(selectors => {
          selectors.walk(node => {
            if (node.type === 'class' || node.type === 'id') {
              const normalized = identifiers.get(node.value) ?? node.value;
              node.setPropertyAndEscape('value', normalized, cssesc(normalized, { isIdentifier: true }));
            }
          });
        }).processSync(node.selector, { lossless: false }) + ' {';
      } else if (node.type === 'atrule') {
        line = '@' + node.name + (node.params ? ' ' + normalizeValue(node.params, identifiers) : '') + (node.nodes ? ' {' : ';');
      } else if (node.type === 'decl') {
        return [node.prop + ': ' + normalizeValue(node.value, identifiers) + (node.important ? ' !important' : '') + ';'];
      } else throw new Error(`Unsupported CSS node: ${node.type}`);
      return node.nodes ? [line, ...node.nodes.flatMap(visit).map(line => '  ' + line), '}'] : [line];
    }
    return postcss.parse(css).nodes.flatMap(visit).join('\n') + '\n';
  }
  const resolveLoader = { modules: [path.join(fixture, 'node_modules'), path.join(root, 'tests/rspack-test/node_modules'), 'node_modules'] };
  function commonConfig(name) {
    return { context: fixture, mode: 'development', target: 'node', devtool: false, cache: false,
      entry: entries, resolve: textConfig.resolve, resolveLoader,
      optimization: { minimize: false, concatenateModules: false, moduleIds: 'named', chunkIds: 'named', emitOnErrors: true },
      output: { path: path.join(out, 'build', name), filename: '[name].cjs', cssFilename: '[name].css',
        uniqueName: '', publicPath: '', library: { type: 'commonjs2' } },
    };
  }
  const nativeConfig = { ...textConfig, ...commonConfig('native'), name: 'native',
    module: { ...textConfig.module, parser: { css: { exportType: 'link' } }, rules: textConfig.module.rules.map(rule => ({ ...rule,
      ...(rule.type?.startsWith('css') ? { generator: { ...rule.generator, exportsOnly: false } } : {}),
    })) },
  };
  function loaderOptions(generator) {
    const modules = { mode: 'local', namedExport: false, exportLocalsConvention: 'as-is',
      localIdentContext: fixture, localIdentHashFunction: 'xxhash64',
      localIdentHashDigest: 'base64url', localIdentHashDigestLength: 6 };
    for (const key of ['localIdentName', 'localIdentHashFunction', 'localIdentHashDigest', 'localIdentHashDigestLength', 'localIdentHashSalt']) {
      if (generator[key] !== undefined) modules[key] = generator[key];
    }
    if (generator.localIdentName) {
      modules.localIdentName = generator.localIdentName.replaceAll('[fullhash]', '[hash]');
    } else {
      // Match the fixture's named-module prefix; css-loader still performs its own escaping.
      modules.getLocalIdent = (context, _template, local) => {
        const id = path.relative(fixture, context.resourcePath).replaceAll(path.sep, '/')
          .replace(/^([.-]|[^a-zA-Z0-9_-])+/, '').replace(/[^a-zA-Z0-9@_-]+/g, '_');
        return `${id}-${local}`;
      };
    }
    return { esModule: false, exportType: 'array', sourceMap: false, importLoaders: 0, modules };
  }
  const customRules = textConfig.module.rules.filter(rule => rule.resourceQuery && rule.generator);
  const loaderConfig = { ...commonConfig('css-loader'), name: 'css-loader', experiments: { css: false },
    module: { rules: [{ test: /\.(css|less)$/, type: 'javascript/auto', oneOf: [
      ...customRules.map(rule => ({ resourceQuery: rule.resourceQuery, use: [{ loader: cssLoader, options: loaderOptions(rule.generator) }] })),
      { use: [{ loader: cssLoader, options: loaderOptions({}) }] },
    ] }, ...textConfig.module.rules.filter(rule => rule.use)] },
  };
  const builds = {};
  async function build(config) {
    console.log(`Building ${config.name}: ${imports.length} fixture entries`);
    const compiler = rspack(config);
    let stats;
    try {
      stats = await new Promise((resolve, reject) => compiler.run((error, result) => error ? reject(error) : resolve(result)));
    } finally { await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve())); }
    const info = stats.toJson({ all: false, errors: true, warnings: true });
    builds[config.name] = { errors: info.errors ?? [], warnings: info.warnings ?? [] };
    await write(`build/${config.name}/diagnostics.json`, builds[config.name]);
  }
  for (const config of [nativeConfig, loaderConfig]) {
    try {
      await build(config);
    } catch (error) {
      builds[config.name] = { errors: [{ message: error.stack ?? String(error) }], warnings: [] };
      await write(`build/${config.name}/diagnostics.json`, builds[config.name]);
    }
  }
  async function execute(kind, name) {
    const filename = path.join(out, 'build', kind, name + '.cjs');
    const code = await fs.readFile(filename, 'utf8');
    const module = { exports: {} };
    new vm.Script(code, { filename }).runInNewContext({ module, exports: module.exports,
      require: createRequire(filename), __dirname: path.dirname(filename), __filename: filename,
      console, URL, Buffer, process,
    }, { timeout: 5000 });
    return module.exports;
  }
  const results = new Map();
  const aggregate = cssRequire('./runtime/api.js')(cssRequire('./runtime/noSourceMaps.js'));
  for (const { name, request } of imports) {
    const result = { name, request, errors: {} };
    for (const kind of ['native', 'css-loader']) {
      try {
        const output = await execute(kind, name);
        if (kind === 'native') {
          const css = await fs.readFile(path.join(out, 'build/native', name + '.css'), 'utf8')
            .catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
          result[kind] = { css, locals: withoutDefault(output) };
        } else {
          if (!Array.isArray(output)) throw new Error('css-loader did not export a CSS array');
          result[kind] = { css: output.toString(), locals: withoutDefault(output.locals ?? {}) };
          aggregate.i(output, undefined, true);
        }
        await write(`css/${name}/${kind}.css`, result[kind].css);
        await write(`css/${name}/${kind}.locals.json`, result[kind].locals);
      } catch (error) {
        result.errors[kind] = error.stack ?? String(error);
        await write(`css/${name}/${kind}.error.txt`, result.errors[kind]);
      }
    }
    const expected = result.native?.css ?? '# Native build/execution failed\n' + result.errors.native;
    const actual = result['css-loader']?.css ?? '# css-loader build/execution failed\n' + result.errors['css-loader'];
    result.cssStatus = Object.keys(result.errors).length ? 'error' : expected === actual ? 'equal' : 'different';
    await write(`css/${name}/raw.diff`, diff(expected, actual));
    if (!Object.keys(result.errors).length) {
      try {
        const a = normalizeCss(expected, request, result.native.locals), b = normalizeCss(actual, request, result['css-loader'].locals);
        result.normalizedCssStatus = a === b ? 'equal' : 'different';
        await write(`css/${name}/native.normalized.css`, a);
        await write(`css/${name}/css-loader.normalized.css`, b);
        await write(`css/${name}/normalized.diff`, diff(a, b));
      } catch (error) {
        result.normalizedCssStatus = 'error';
        await write(`css/${name}/normalized.diff`, '# CSS normalization failed; inspect raw.diff\n' + error.stack);
      }
    } else {
      result.normalizedCssStatus = 'error';
      await write(`css/${name}/normalized.diff`, '# Comparison unavailable; inspect raw.diff and *.error.txt\n');
    }
    results.set(name, result);
  }
  const incompleteBundle = [...results.values()].some(result => result.errors['css-loader']);
  await write(incompleteBundle ? 'bundle.css-loader.partial.css' : 'bundle.css-loader.css', aggregate.toString());
  const snapshotResults = [];
  for (const filename of snapshots) {
    const expected = await fs.readFile(path.join(fixture, '__snapshot__', filename), 'utf8');
    let actual, status, normalizedStatus, normalizedDiff, nativeStatus = 'not-applicable', notice = '';
    if (filename === 'bundle0.css.txt') {
      const failed = [...results.values()].filter(result => result.errors['css-loader']).map(result => result.name);
      actual = serialize([aggregate.toString()]);
      status = failed.length ? 'error' : expected === actual ? 'equal' : 'different';
      if (failed.length) notice = '# INCOMPLETE: css-loader failed for ' + failed.join(', ') + '. See css/*/*.error.txt\n';
      normalizedStatus = 'not-applicable';
      normalizedDiff = '# Combined snapshot: inspect per-fixture css/*/normalized.diff\n';
    } else {
      const match = /^(.*)\.(link|text|css-style-sheet|style)\.txt$/.exec(filename);
      const result = match && results.get(match[1]);
      if (!result) {
        actual = '# Unmapped snapshot: ' + filename;
        status = 'error';
      } else if (result.errors['css-loader']) {
        actual = '# css-loader execution failed\n' + result.errors['css-loader'];
        status = 'error';
      } else {
        actual = serialize(result['css-loader'].locals);
        status = actual === expected ? 'equal' : 'different';
      }
    }
    if (filename !== 'bundle0.css.txt') {
      const result = results.get(filename.replace(/\.(link|text|css-style-sheet|style)\.txt$/, ''));
      const normalize = text => text.split('\n').map(line => line.endsWith(',')
        ? normalizeHash(line.slice(0, -1), result?.request) + ',' : line).join('\n');
      normalizedStatus = status === 'error' ? 'error' : normalize(expected) === normalize(actual) ? 'equal' : 'different';
      normalizedDiff = diff(normalize(expected), normalize(actual), filename, 'css-loader (normalized hashes)');
      if (result && !result.native) nativeStatus = 'error';
      if (result?.native) {
        const native = serialize(result.native.locals);
        nativeStatus = native === expected ? 'equal' : 'different';
        await write(`snapshots/${filename}.native.actual`, native);
        await write(`snapshots/${filename}.native.diff`, diff(expected, native, filename, 'native rerun'));
      }
    }
    await write(`snapshots/${filename}.expected`, expected);
    await write(`snapshots/${filename}.actual`, actual);
    await write(`snapshots/${filename}.diff`, notice + diff(expected, actual, filename, 'css-loader'));
    await write(`snapshots/${filename}.normalized.diff`, normalizedDiff);
    snapshotResults.push({ snapshot: filename, status, normalizedStatus, nativeStatus, diff: `snapshots/${filename}.diff` });
  }
  const count = (rows, key) => Object.fromEntries(['equal', 'different', 'error', 'not-applicable'].map(status => [status, rows.filter(row => row[key] === status).length]));
  const report = { rspack: root, fixture, cssLoader, output: out,
    note: 'Four export modes reuse css-loader array/locals results. Native CSS comes from link assets, including composition dependencies. Raw differences retain hashes; normalized comparisons ignore only configured hash suffixes, CSS comments/formatting and simple string quote style. Rule/declaration/class composition order is preserved.',
    builds, totals: { snapshots: count(snapshotResults, 'status'), normalizedSnapshots: count(snapshotResults, 'normalizedStatus'), nativeSnapshots: count(snapshotResults, 'nativeStatus'), css: count([...results.values()], 'cssStatus'), normalizedCss: count([...results.values()], 'normalizedCssStatus') },
    snapshots: snapshotResults,
    fixtures: [...results.values()].map(({ native, 'css-loader': loader, ...result }) => result),
  };
  await write('report.json', report);
  await write('summary.txt', `${JSON.stringify(report.totals, null, 2)}\n\n` + snapshotResults.map(row => `${row.status.padEnd(9)} ${row.diff}`).join('\n') + '\n');
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(`Report: ${path.join(out, 'report.json')}`);
  process.exitCode = Object.values(builds).some(build => build.errors.length) || report.totals.snapshots.error || report.totals.css.error || report.totals.normalizedCss.error || report.totals.nativeSnapshots.error || report.totals.nativeSnapshots.different ? 2
    : args['fail-on-diff'] && (report.totals.normalizedSnapshots.different || report.totals.normalizedCss.different) ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 2;
});
