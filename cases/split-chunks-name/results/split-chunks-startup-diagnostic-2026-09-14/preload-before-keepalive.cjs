const wt = require('node:worker_threads');
const fs = require('node:fs');
const { registerHooks } = require('node:module');
const events = [];
const stamp = (name, data = {}, time = process.hrtime.bigint()) => events.push({ name, time: String(time), ...data });
if (wt.isMainThread) {
  const ready = [];
  const OriginalWorker = wt.Worker;
  wt.Worker = class extends OriginalWorker {
    constructor(filename, options) {
      stamp('worker-constructor-start');
      super(filename, options);
      const threadId = this.threadId;
      stamp('worker-constructor-end', { threadId });
      ready.push(new Promise((resolve, reject) => {
        this.on('message', message => {
          if (message?.type === 'rspack-loader-worker-ready') { stamp('worker-ready-received', { threadId }); resolve(); }
          if (message?.type === 'diagnostic-first-name') stamp('first-name', { threadId }, message.time);
        });
        this.once('error', reject);
      }));
    }
  };
  global.__startupMark = stamp;
  global.__startupWait = async () => {
    stamp('prebuild-wait-start');
    if (process.env.DIAGNOSTIC_WAIT_READY === '1') await Promise.all(ready);
    stamp('prebuild-wait-end');
  };
  process.on('exit', () => fs.writeFileSync(process.env.DIAGNOSTIC_TRACE, JSON.stringify(events, null, 2) + '\n'));
}
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (wt.isMainThread && url.endsWith('/cases/split-chunks-name/run-build.mjs')) {
    let source = String(result.source);
    const replacements = [
      ['const compiler = rspack.rspack(config);', "global.__startupMark('compiler-start');\nconst compiler = rspack.rspack(config);\nglobal.__startupMark('compiler-end');"],
      ['marks[name] = now();', "marks[name] = now(); global.__startupMark(name);"],
      ['const start = now();', "await global.__startupWait();\nglobal.__startupMark('build-start');\nconst start = now();"],
      ['buildMs = ms(start, now());', "buildMs = ms(start, now()); global.__startupMark('build-end');"]
    ];
    for (const [from, to] of replacements) {
      if (!source.includes(from)) throw new Error('Missing diagnostic injection: ' + from);
      source = source.replace(from, to);
    }
    return { ...result, source };
  }
  if (!wt.isMainThread && url.endsWith('/cases/split-chunks-name/name.cjs')) {
    const source = String(result.source);
    const target = 'module.exports = function (module, chunks, cacheGroupKey, options) {';
    if (!source.includes(target)) throw new Error('Missing name diagnostic injection');
    return { ...result, source: 'let diagnosticFirst = true;\n' + source.replace(target, target + "\nif (diagnosticFirst) { diagnosticFirst = false; require('node:worker_threads').parentPort.postMessage({type:'diagnostic-first-name', time:String(process.hrtime.bigint())}); }") };
  }
  return result;
}});
