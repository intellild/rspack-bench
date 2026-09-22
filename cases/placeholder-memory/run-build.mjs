import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { configuration } from './config.mjs';
const job = JSON.parse(await readFile(process.argv[2], 'utf8'));
const require = createRequire(import.meta.url);
const native = require(job.native);
assert.equal(
  typeof native.benchmarkMemory,
  'function',
  'Instrumented native binding required',
);
const rspack = require(job.core);
const deps = createRequire(path.join(job.dependencies, 'package.json'));
const binaries = Object.keys(require.cache).filter(
  (p) => p.endsWith('.node') && /rspack|placeholder-memory/.test(p),
);
assert.deepEqual(
  binaries,
  [job.native],
  'Must load exactly the selected native binding',
);
const markers = [
  '$$RUNTIME_GLOBAL_',
  'RSPACK_AUTO_URL_STATIC_PLACEHOLDER_',
  'RSPACK_AUTO_WORKER_STATIC_URL_PLACEHOLDER_',
  '__RSPACK_ESM_CHUNK_',
  '*-*-*-CHUNK-SRI-HASH-',
  '/* RSTEST:',
  '__RSPACK_PLUGIN_CSS_MODULE_ID__',
  '__RSPACK_PLUGIN_CSS_AUTO_PUBLIC_PATH__',
  '__RSPACK_PLUGIN_ASSET_AUTO_PUBLIC_PATH__',
  'rspack-css-extract:///css-extract-plugin/',
  '__css_extract_single_dot_path_segment__',
  '__css_extract_public_path_auto__',
  'rspack-css-extract://',
];
const audit = { generated: {}, preProcess: {}, executedCss: {} };
function scan(text, into) {
  for (const marker of markers) {
    const count = text.split(marker).length - 1;
    if (count) into[marker] = (into[marker] ?? 0) + count;
  }
}
const config = configuration(job, rspack, deps);
if (job.audit)
  config.plugins.push({
    apply(compiler) {
      compiler.hooks.compilation.tap('PlaceholderAudit', (compilation) => {
        compilation.hooks.executeModule.tap(
          { name: 'PlaceholderAudit', stage: 10000 },
          ({ moduleObject }) => {
            const exports = moduleObject.exports;
            const css = exports?.__esModule ? exports.default : exports;
            if (Array.isArray(css))
              for (const row of css)
                if (Array.isArray(row) && typeof row[1] === 'string')
                  scan(row[1], audit.executedCss);
          },
        );
        compilation.hooks.afterProcessAssets.tap('PlaceholderAudit', () => {
          for (const chunk of compilation.chunks) {
            for (const module of compilation.chunkGraph.getChunkModules(
              chunk,
            )) {
              const runtime = [...chunk.runtime];
              const result = compilation.codeGenerationResults.get(
                module,
                runtime,
              );
              if (!result) continue;
              for (const type of ['javascript', 'css']) {
                const source = result.sources.get(type);
                if (source) scan(source.source().toString(), audit.generated);
              }
            }
          }
        });
        compilation.hooks.processAssets.tap(
          { name: 'PlaceholderAudit', stage: -10000 },
          (assets) => {
            for (const source of Object.values(assets))
              scan(source.source().toString(), audit.preProcess);
          },
        );
      });
    },
  });
// Import/init is excluded. Compiler construction + one cold compilation are included.
const baseline = native.benchmarkMemory(true);
const start = performance.now();
const compiler = rspack.rspack(config);
const stats = await new Promise((resolve, reject) =>
  compiler.run((error, stats) => (error ? reject(error) : resolve(stats))),
);
const memory = native.benchmarkMemory(false);
const elapsedMs = performance.now() - start;
const summary = stats.toJson({
  all: false,
  errors: true,
  warnings: true,
  assets: true,
  assetsSpace: Infinity,
});
assert.deepEqual(summary.errors, [], JSON.stringify(summary.errors));
assert.deepEqual(summary.warnings, [], JSON.stringify(summary.warnings));
const output = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(p);
    else output.push(p);
  }
}
await walk(job.output);
const hashes = {},
  css = [],
  js = [];
for (const file of output.sort()) {
  const bytes = await readFile(file);
  hashes[path.relative(job.output, file)] = createHash('sha256')
    .update(bytes)
    .digest('hex');
  if (/\.(?:js|css)$/.test(file)) {
    const text = bytes.toString();
    for (const marker of markers)
      assert(
        !text.includes(marker),
        `${job.scenario}: leftover ${marker} in ${file}`,
      );
    (file.endsWith('.css') ? css : js).push(text);
  }
}
const code = js.join('\n'),
  style = css.join('\n');
assert(js.length > 0);
if (job.scenario === 'runtime-template') {
  assert.equal(
    Object.keys(hashes).filter((x) => /runtime-entry-\d+\.js$/.test(x)).length,
    Math.min(16, job.modules),
  );
  assert(
    /Object\.keys\(__webpack_require__\.O\)\.every/.test(code),
    'Runtime template global replacement',
  );
  assert(code.includes('__webpack_require__.O[key](chunkIds[j])'));
}
if (job.scenario.startsWith('css-')) {
  assert(css.length > 1, 'Initial and lazy CSS chunks');
  assert.equal(
    [...style.matchAll(/__rule0\s*\{/g)].length,
    job.modules,
    'Every CSS module is emitted',
  );
  assert(style.includes('image-0.svg'));
  assert(style.includes(`image-${job.modules - 1}.svg`));
  assert(
    style.includes('data:image/svg+xml'),
    'Inline assets exercise no-match path',
  );
  assert(
    style.includes('image-0.base.svg'),
    'Asset-specific empty publicPath exercises base URI',
  );
}
if (job.scenario === 'css-native-sri') {
  assert(code.includes('background-image'), 'CSS text export');
  assert(style.includes('__rule0'), '[id] CSS local identifiers');
}
if (job.scenario === 'css-extract-relative')
  assert(
    style.includes('../cdn.v1/assets/image-0.svg'),
    'Relative publicPath and escaped dots',
  );
if (job.scenario.endsWith('-sri')) {
  assert(code.includes('sha256-'));
  assert(code.includes('sha384-'));
  assert(code.includes('sri'));
}
if (job.scenario.includes('worker') || job.scenario === 'modern-module') {
  assert(code.includes('new Worker('));
  assert(Object.keys(hashes).some((x) => x.includes('worker-0')));
}
if (job.scenario === 'modern-module' || job.scenario === 'module-preserve') {
  assert(
    /import\s+[\w$]+\s+from\s+["'][^"']*image-\d+\.keep\.svg/.test(code),
    'Preserved asset imports',
  );
  assert(
    code.includes('import(') && code.includes('lazy-0'),
    'Linked ESM async chunks',
  );
}
if (job.scenario === 'url-relative' || job.scenario === 'url-worker')
  assert(code.includes('image-0.svg'));
if (job.scenario === 'rstest')
  for (const name of [
    'rstest_mock',
    'rstest_unmock',
    'rstest_mock_require',
    'rstest_hoisted',
  ])
    assert(code.includes(name), name);
if (job.scenario === 'node-external')
  for (const name of [
    'node:fs',
    'assert/strict',
    'pnpapi',
    'node:rspack-future-builtin',
    'module.exports = 42',
  ])
    assert(code.includes(name), name);
if (job.audit) {
  const requireMarker = (phase, marker) =>
    assert(audit[phase][marker] > 0, `${job.scenario} must generate ${marker}`);
  if (job.scenario === 'css-native-sri')
    requireMarker('generated', '__RSPACK_PLUGIN_CSS_AUTO_PUBLIC_PATH__');
  if (job.scenario.startsWith('css-extract')) {
    requireMarker('executedCss', 'rspack-css-extract:///css-extract-plugin/');
    requireMarker('executedCss', 'rspack-css-extract://');
    assert(
      audit.executedCss['rspack-css-extract://'] >
        audit.executedCss['rspack-css-extract:///css-extract-plugin/'],
      'Bare base URI must occur independently of the absolute-publicPath prefix',
    );
    requireMarker(
      'executedCss',
      job.scenario === 'css-extract-relative'
        ? '__css_extract_single_dot_path_segment__'
        : '__css_extract_public_path_auto__',
    );
  }
  if (job.scenario.endsWith('-sri'))
    requireMarker('preProcess', '*-*-*-CHUNK-SRI-HASH-');
  if (
    ['url-worker', 'modern-module', 'module-preserve'].includes(job.scenario)
  ) {
    requireMarker('generated', 'RSPACK_AUTO_URL_STATIC_PLACEHOLDER_');
    requireMarker('generated', '__RSPACK_PLUGIN_ASSET_AUTO_PUBLIC_PATH__');
  }
  if (['url-worker', 'modern-module'].includes(job.scenario))
    requireMarker('generated', 'RSPACK_AUTO_WORKER_STATIC_URL_PLACEHOLDER_');
  if (job.scenario === 'modern-module')
    requireMarker('preProcess', '__RSPACK_ESM_CHUNK_');
  if (job.scenario === 'rstest') requireMarker('preProcess', '/* RSTEST:');
}
const result = {
  version: job.version,
  scenario: job.scenario,
  run: job.run,
  audit: job.audit,
  modules: job.modules,
  elapsedMs,
  baselineBytes: baseline[0],
  peakBytes: memory[1],
  peakAboveBaselineBytes: memory[1] - baseline[0],
  liveBytes: memory[0],
  liveAboveBaselineBytes: memory[0] - baseline[0],
  allocatedBytes: memory[2] - baseline[2],
  allocationCalls: memory[3] - baseline[3],
  outputCount: output.length,
  outputHashes: hashes,
  coverage: audit,
  loadedNative: binaries[0],
  node: process.version,
};
await new Promise((resolve, reject) =>
  compiler.close((error) => (error ? reject(error) : resolve())),
);
await writeFile(job.result, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    version: job.version,
    scenario: job.scenario,
    run: job.run,
    peakMiB: result.peakBytes / 2 ** 20,
    allocatedMiB: result.allocatedBytes / 2 ** 20,
  }),
);
