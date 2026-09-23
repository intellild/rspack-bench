// Diagnostic builds only. Builtin CSS has no JS loader to instrument.
const { appendFileSync } = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { threadId } = require('node:worker_threads');
const directory = process.env.BABEL_MATRIX_AUDIT_DIR;
if (directory) {
  const originalLoad = Module._load, wrappers = new WeakMap();
  const record = (kind, resource, request, start, success) => {
    const end = process.hrtime.bigint();
    appendFileSync(path.join(directory, `js-${threadId}.jsonl`), JSON.stringify({ kind, resource, request,
      threadId, startNs: String(start), endNs: String(end), durationMs: Number(end-start)/1e6, success }) + '\n');
  };
  const wrapLoader = (fn, kind) => function (...args) {
    const start = process.hrtime.bigint(), resource = this.resourcePath, request = this.request;
    let finished = false, asyncUsed = false;
    const finish = success => { if (!finished) { finished = true; record(kind, resource, request, start, success); } };
    const originalAsync = this.async, originalCallback = this.callback;
    this.callback = function(error, ...values) { finish(!error); return originalCallback.call(this, error, ...values); };
    this.async = function (...asyncArgs) {
      asyncUsed = true;
      const callback = originalAsync.apply(this, asyncArgs);
      return function(error, ...values) { finish(!error); return callback(error, ...values); };
    };
    try {
      const result = fn.apply(this, args);
      if (result && typeof result.then === 'function') return result.then(v => { finish(true); return v; }, e => { finish(false); throw e; });
      if (!asyncUsed) finish(true);
      return result;
    } catch (error) { finish(false); throw error; }
    finally { this.async = originalAsync; this.callback = originalCallback; }
  };
  Module._load = function(request, parent, isMain) {
    const value = originalLoad.apply(this, arguments);
    const filename = Module._resolveFilename(request, parent, isMain);
    const kind = filename === process.env.BABEL_MATRIX_LOADER ? 'loader'
      : filename === process.env.BABEL_MATRIX_TRANSFORM ? 'transform' : null;
    if (!kind) return value;
    if (!wrappers.has(value)) {
      let wrapped;
      if (kind === 'transform') {
        wrapped = async function(source, options) {
          const start = process.hrtime.bigint();
          try {
            const result = await value.apply(this, arguments);
            if (typeof result?.code !== 'string') throw new Error('Babel did not generate code');
            record(kind, options.filename, null, start, true); return result;
          } catch (error) { record(kind, options.filename, null, start, false); throw error; }
        };
        Object.assign(wrapped, value);
      } else { wrapped = wrapLoader(value, kind); Object.assign(wrapped, value); }
      wrappers.set(value, wrapped);
    }
    return wrappers.get(value);
  };
}
