// Validation-only preload, inherited by Rspack's loader worker threads.
// Measured processes never load this file.
const { readFileSync, appendFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { threadId } = require('node:worker_threads');
const job = JSON.parse(readFileSync(process.env.RSPACK_BENCH_VERIFY_JOB, 'utf8'));
const req = createRequire(path.resolve(__dirname, '..', 'versions', job.version, 'package.json'));
const journal = path.join(job.auditDir, `thread-${threadId}.jsonl`);
const record = (event, filename) => appendFileSync(journal, JSON.stringify({ event, filename, threadId }) + '\n');
const loaderPath = req.resolve('less-loader');
const originalLoader = req(loaderPath);
function countedLoader(...args) {
  record('loader', this.resourcePath);
  return originalLoader.apply(this, args);
}
Object.assign(countedLoader, originalLoader);
countedLoader.default = countedLoader;
req.cache[loaderPath].exports = countedLoader;
const less = req('less');
const originalRender = less.render;
less.render = function (source, options, ...args) {
  record('render', options.filename);
  return originalRender.call(this, source, options, ...args);
};
