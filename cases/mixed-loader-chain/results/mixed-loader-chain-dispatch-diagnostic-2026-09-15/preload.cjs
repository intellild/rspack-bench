const threads = require('node:worker_threads');
const { registerHooks } = require('node:module');
const fs = require('node:fs');
const shared = threads.workerData?.mixedDiagnosticCounters ?? new SharedArrayBuffer(128 * 4);
const counters = new Int32Array(shared);
const names = ['mainPitch', 'mainNormal', 'mainHooksPitch', 'mainHooksNormal', 'workerPitch', 'workerNormal', 'optionsRequests', 'functionInvokes', 'additionalDataRequests'];
global.__mixedRunner = (context, worker) => {
  const base = worker ? 4 : context.__internal__runHooksOnly ? 2 : 0;
  const state = context.loaderState === 'Pitching' ? 0 : context.loaderState === 'Normal' ? 1 : -1;
  if (state < 0) throw new Error('Unexpected loader state');
  Atomics.add(counters, base + state, 1);
};
const originalPost = threads.MessagePort.prototype.postMessage;
threads.MessagePort.prototype.postMessage = function(message, ...args) {
  if (message?.type === 'loader-options-request') {
    Atomics.add(counters, 6, 1);
    if (message.optionsHandle < 100) Atomics.add(counters, 16 + message.optionsHandle, 1);
  }
  if (message?.type === 'function-invoke') Atomics.add(counters, 7, 1);
  if (message?.type === 'loader-additional-data-request') Atomics.add(counters, 8, 1);
  return originalPost.call(this, message, ...args);
};
if (threads.isMainThread) {
  const Worker = threads.Worker;
  threads.Worker = class extends Worker {
    constructor(filename, options) {
      super(filename, options?.workerData?.rspackNativeLoaderWorker ? {
        ...options, workerData: { ...options.workerData, mixedDiagnosticCounters: shared },
      } : options);
    }
  };
  const builds = [];
  let before, state;
  const snapshot = () => Array.from(counters, (_, i) => Atomics.load(counters, i));
  const counts = values => ({
    ...Object.fromEntries(names.map((name, i) => [name, values[i]])),
    optionsHandles: Object.fromEntries(values.slice(16).map((value, i) => [i, value]).filter(([,v]) => v)),
  });
  global.__mixedDiagBegin = value => { state = value; before = snapshot(); };
  global.__mixedDiagEnd = value => {
    const after = snapshot();
    builds.push({ state: value, counts: counts(after.map((v,i) => v - before[i])) });
    state = undefined;
  };
  process.on('exit', () => fs.writeFileSync(process.env.MIXED_DISPATCH_REPORT, JSON.stringify({
    builds, incompleteState: state, total: counts(snapshot()),
  }, null, 2) + '\n'));
}
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  let source;
  if (/\/a77f\/rspack\/packages\/rspack\/dist\/(index|worker)\.js$/.test(url)) {
    source = String(result.source);
    const needle = 'async function runLoadersInternal(compiler, context, worker = !1) {';
    if (!source.includes(needle)) throw new Error('Loader runner entry changed');
    source = source.replace(needle, needle + '\nglobal.__mixedRunner(context, worker);\n');
  } else if (url.endsWith('/cases/mixed-loader-chain/run-build.mjs')) {
    source = String(result.source);
    for (const [needle, extra] of [
      ['marks = {}; builtResources = new Set();', 'global.__mixedDiagBegin(state);'],
      ['builds.push({ state, timings, validation });', 'global.__mixedDiagEnd(state);'],
    ]) {
      if (!source.includes(needle)) throw new Error('Benchmark runner changed');
      source = source.replace(needle, needle + extra);
    }
  }
  return source === undefined ? result : { ...result, source };
}});
