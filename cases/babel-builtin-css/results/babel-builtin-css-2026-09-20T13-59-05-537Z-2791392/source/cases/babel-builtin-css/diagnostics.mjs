import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
export async function analyzeDiagnostics(dir, records) {
  const reports = [], lines = ['# Loader latency and overhead diagnostics', '',
    'Instrumented validation builds only; excluded from performance samples. Cells show **p50 / p95 / max** in milliseconds. JSON includes count, mean and sum. These are elapsed task latencies, including waits; overlapping sums are not CPU time or build wall time.', '',
    'Builtin CSS uses no JS loaders. CSS module lifecycle latency is measured separately; it is not loader dispatch overhead. Babel transform is nested inside Babel loader body.', ''];
  for (const record of records) {
    const audit = record.auditDirectory;
    const js = (await Promise.all((await readdir(audit)).filter(f => /^js-\d+\.jsonl$/.test(f)).map(f => jsonl(path.join(audit, f))))).flat();
    assert(js.every(row => row.success));
    const native = record.version === 'worktree-bec7' ? await jsonl(path.join(audit, 'native.jsonl')) : [];
    assert(native.every(row => row.success));
    assert(native.every(task => !task.resource.endsWith('.module.css')), 'Builtin CSS must not dispatch JS tasks');
    const nativeKind = task => task.resource.endsWith('.js') && task.phase === 'normal' ? 'loader' : 'otherPitch';
    const transforms = groupBy(js.filter(r => r.kind === 'transform'), r => r.resource);
    for (const calls of transforms.values()) calls.sort(byStart);
    const report = { version: record.version, rows: [], otherTasks: summarize(native.filter(r => nativeKind(r) === 'otherPitch').map(r => r.totalMs)) };
    for (const kind of ['loader']) {
      const bodies = groupBy(js.filter(r => r.kind === kind), r => r.resource);
      const tasks = groupBy(native.filter(r => nativeKind(r) === kind), r => r.resource);
      assert.equal(bodies.size, record.modules);
      for (const calls of bodies.values()) { calls.sort(byStart); assert.equal(calls.length, 2); }
      if (native.length) {
        assert.equal(tasks.size, record.modules, `Native task resource count for ${kind}`);
        for (const calls of tasks.values()) { calls.sort(byStart); assert.equal(calls.length, 2, `One ${kind} task per resource and build`); }
      }
      for (const [index, state] of ['cold','warm'].entries()) {
        const moduleRows = JSON.parse(await readFile(path.join(audit, `modules-${state}.json`), 'utf8'));
        const moduleMap = new Map(moduleRows.filter(row => row.resource.endsWith('.js')).map(row => [row.resource, row.durationMs]));
        assert.equal(moduleMap.size, record.modules, `Module lifecycle count for ${kind}`);
        const samples = [];
        for (const [resource, calls] of bodies) {
          const body = calls[index];
          assert(body.threadId > 0);
          const sample = { resource, threadId: body.threadId, bodyMs: body.durationMs, moduleMs: moduleMap.get(resource), moduleResidualMs: moduleMap.get(resource)-body.durationMs };
          if (kind === 'loader') {
            sample.babelTransformMs = transforms.get(resource)[index].durationMs;
            sample.babelAdapterMs = body.durationMs - sample.babelTransformMs;
          }
          if (native.length) {
            const task = tasks.get(resource)[index];
            assert.equal(task.threadId, body.threadId);
            assert.equal(task.parallel, kind === 'loader');
            assert(task.pointsMs.every(value => value !== null));
            const [queued, received, entered, contextStart, contextReady, complete, returned] = task.pointsMs;
            const ordered = [0, ...task.pointsMs, task.totalMs];
            for (let i = 1; i < ordered.length; i++) assert(ordered[i] >= ordered[i-1]);
            Object.assign(sample, { taskId: task.id, taskTotalMs: task.totalMs, dispatchPreparationMs: queued,
              queueWaitMs: received-queued, eventLoopWaitMs: entered-received, callbackSetupMs: contextStart-entered,
              nativeContextPreparationMs: contextReady-contextStart, jsIntervalMs: complete-contextReady,
              jsResidualMs: complete-contextReady-body.durationMs, nativeMergeMs: returned-complete,
              restoreMs: task.totalMs-returned, taskResidualMs: task.totalMs-body.durationMs });
            assert(sample.jsResidualMs >= -0.01, `Body outside native interval: ${kind} ${resource}`);
          }
          samples.push(sample);
        }
        const metrics = Object.fromEntries(Object.keys(samples[0]).filter(key => key.endsWith('Ms')).map(key => [key, summarize(samples.map(s => s[key]))]));
        report.rows.push({ state, kind, count: samples.length, metrics });
        await writeFile(path.join(audit, `joined-${state}-${kind}.json`), JSON.stringify(samples)+'\n');
      }
    }
    report.cssModuleLifecycle = {};
    for (const state of ['cold', 'warm']) {
      const rows = JSON.parse(await readFile(path.join(audit, `modules-${state}.json`), 'utf8')).filter(row => row.resource.endsWith('.module.css'));
      assert.equal(rows.length, record.modules);
      assert.equal(new Set(rows.map(row => row.resource)).size, record.modules);
      report.cssModuleLifecycle[state] = summarize(rows.map(row => row.durationMs));
    }
    reports.push(report);
    lines.push(`## ${record.version}`, '', '| State / loader | Calls | Loader body | Babel transform | Babel adapter | Module residual | Native task total | Task residual |', '|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of report.rows) lines.push(`| ${r.state} / ${r.kind} | ${r.count} | ${['bodyMs','babelTransformMs','babelAdapterMs','moduleResidualMs','taskTotalMs','taskResidualMs'].map(k => fmt(r.metrics[k])).join(' | ')} |`);
    lines.push('', `Builtin CSS module lifecycle cold: ${fmt(report.cssModuleLifecycle.cold)} ms; rebuild: ${fmt(report.cssModuleLifecycle.warm)} ms.`, '');
    if (native.length) {
      lines.push('', '| State / loader | Dispatch prepare | Queue wait | Event-loop wait | Callback + main prepare | Native context prepare | JS residual | Native merge | Rust wake + restore |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
      for (const r of report.rows) lines.push(`| ${r.state} / ${r.kind} | ${['dispatchPreparationMs','queueWaitMs','eventLoopWaitMs','callbackSetupMs','nativeContextPreparationMs','jsResidualMs','nativeMergeMs','restoreMs'].map(k => fmt(r.metrics[k])).join(' | ')} |`);
      lines.push('', `Other tasks (usually Babel pitch): ${report.otherTasks.count}; latency ${fmt(report.otherTasks)} ms.`, '');
    }
  }
  lines.push('', 'Interpretation:', '',
    '- loader = parallel Babel normal. Builtin CSS is verified to have no native JS task or JS proxy module. Every row joins two invocations per resource by cold/rebuild order, and verifies native phase, routing, task count and thread ID.',
    '- Queue wait includes waiting for worker capacity; event-loop wait is receiver to TSFN callback entry.',
    '- Callback + main prepare spans TSFN entry to takeContext. Workers await prepareWorkerTask RPC for the compiler/buildInfo bridge here; parallel loader hooks are skipped. Includes callback setup and locks, so this is not a pure RPC timer.',
    '- Native context preparation is Rust construction only. Subsequent N-API conversion is part of JS interval.',
    '- JS residual subtracts the actual loader body from context-ready to complete-entry. It includes loader-runner work, resolution/loading, RPC, N-API conversion and scheduling; not pure CPU overhead.',
    '- Native merge starts after result conversion; Rust wake + restore includes oneshot scheduling and context restoration.',
    '- Module residual uses buildModule to succeedModule minus body, also covering I/O, pitch, parsing, resolution and hook delivery.',
    '- Diagnostic timers/hooks/file writes affect contention. Compare versions using the separate uninstrumented samples. Native residuals describe this branch; baseline has no equivalent native timer.', '');
  await writeFile(path.join(dir, 'diagnostics.json'), JSON.stringify(reports,null,2)+'\n');
  await writeFile(path.join(dir, 'diagnostics.md'), lines.join('\n'));
  console.log(`Diagnostics: ${path.join(dir, 'diagnostics.md')}`);
}
function groupBy(rows, key) { const map = new Map(); for (const r of rows) { const k = key(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); } return map; }
function byStart(a,b) { return BigInt(a.startNs)<BigInt(b.startNs)?-1:1; }
async function jsonl(file) { return (await readFile(file,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
function summarize(values) {
  const sorted = [...values].sort((a,b)=>a-b), count = values.length, sum = values.reduce((a,b)=>a+b,0);
  const q = p => count ? sorted[Math.max(0,Math.ceil(count*p)-1)] : null;
  return { count,sum,mean:count?sum/count:null,p50:q(.5),p95:q(.95),max:count?sorted.at(-1):null };
}
function fmt(value) { return value?.count ? [value.p50,value.p95,value.max].map(n=>n.toFixed(3)).join(' / ') : '—'; }
