// Validation only; workers inherit --require. Measured builds do not load this file.
const { appendFileSync } = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { threadId } = require('node:worker_threads');
const directory = process.env.MIXED_CHAIN_AUDIT_DIR;
if (directory) {
  const paths = JSON.parse(process.env.MIXED_CHAIN_LOADERS);
  const originalLoad = Module._load;
  const wrappers = new WeakMap();
  Module._load = function (request, parent, isMain) {
    const value = originalLoad.apply(this, arguments);
    if (typeof value !== 'function') return value;
    const index = paths.indexOf(Module._resolveFilename(request, parent, isMain));
    if (index < 0) return value;
    if (!wrappers.has(value)) {
      const wrapped = function (...args) {
        appendFileSync(path.join(directory, `${threadId}.jsonl`), JSON.stringify({
          index, resource: this.resourcePath, threadId, time: String(process.hrtime.bigint()),
        }) + '\n');
        return value.apply(this, args);
      };
      Object.assign(wrapped, value);
      wrappers.set(value, wrapped);
    }
    return wrappers.get(value);
  };
}
