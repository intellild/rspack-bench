# Parallel loader main-thread bridge diagnostic

Local a77f, 10,000 existing JS modules, Babel loader, parallel on, use.cache off. All other configurable build caches remain disabled as in the matrix case. One cold build and one full rebuild passed module, loader-chain, bundle-hash and exported-value checks.

The preload intercepts MessagePort.postMessage in main and worker isolates without changing the Rspack artifact. Across both builds, workers sent 20,001 loader-options-request messages, all for handle 1; main sent 20,001 responses. No function-invoke or loader-additional-data-request messages were observed. These totals include pitching as well as normal loader tasks.

The source also unconditionally calls run_on_main(context, true) before dispatching each parallel loader task (crates/rspack_binding_api/src/plugins/js_loader/scheduler.rs:89). This native-to-JS path is outside the MessagePort counter.

Worker context creation eagerly calls getLoaderInputFileSystem(optionsHandle), fetching options, compiler metadata and filesystem/function proxies together. getLoaderBridgeData memoizes only within a task: worker.ts clears the map in finally. This explains repeated requests for the same handle. Remote filesystem access is available but was not invoked in this Babel configuration.

Instrumentation performs synchronous logging and affects scheduling. Its timings are not benchmark samples and do not quantify the speedup possible by removing these calls. See summary.json for counts, result.json for validation and artifact hashes, and messages.jsonl.gz for all message records (grouped by thread; no global event ordering is implied).

The archived job and result retain their original absolute paths. To repeat the diagnostic, create fresh output, stats and audit directories; update the job paths and place bridge-preload.cjs beside the new audit directory, then run from the repository root:

```bash
node --require /path/to/bridge-preload.cjs cases/babel-loader-parallel-cache/run-build.mjs /path/to/job.json
```

This diagnostic uses the same local implementation as the [matrix run](../babel-loader-parallel-cache-2026-09-12T00-27-06-288Z-16/README.md); that archive includes the worktree patch and benchmark source snapshots.
