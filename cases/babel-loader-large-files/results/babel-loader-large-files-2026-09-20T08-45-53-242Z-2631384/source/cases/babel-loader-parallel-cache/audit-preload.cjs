// Loaded only in validation processes, including their loader workers.
const { appendFileSync } = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { threadId } = require('node:worker_threads');
const directory = process.env.BABEL_MATRIX_AUDIT_DIR;
if (directory) {
  const originalLoad = Module._load;
  const wrappers = new WeakMap();
  const record = (kind, resource) => appendFileSync(path.join(directory, `${threadId}.jsonl`),
    JSON.stringify({ kind, resource, threadId }) + '\n');
  Module._load = function (request, parent, isMain) {
    const value = originalLoad.apply(this, arguments);
    if (typeof value !== 'function') return value;
    const filename = Module._resolveFilename(request, parent, isMain);
    let kind;
    if (filename === process.env.BABEL_MATRIX_LOADER) kind = 'loader';
    else if (filename === process.env.BABEL_MATRIX_TRANSFORM) kind = 'transform';
    else return value;
    if (!wrappers.has(value)) {
      const wrapped = kind === 'loader' ? function (...args) {
        record(kind, this.resourcePath);
        return value.apply(this, args);
      } : async function (source, options) {
        const result = await value.apply(this, arguments);
        if (typeof result?.code !== 'string') throw new Error('Babel did not generate code');
        record(kind, options.filename);
        return result;
      };
      Object.assign(wrapped, value);
      wrappers.set(value, wrapped);
    }
    return wrappers.get(value);
  };
}
