# Babel loader parallel / cache

Compares Rspack 2.1.0, 2.2.3, and the compiled checkout at `/data00/home/jinzhixin/.codex/worktrees/a77f/rspack`, using the existing 10,000-module JS graph and identical Babel versions selected through pnpm workspaces.

```bash
pnpm install --frozen-lockfile
pnpm bench:babel-loader-parallel-cache --modules 10000 --runs 5
```

| Version | parallel off / cache off | parallel on / cache off | parallel off / cache on | parallel on / cache on |
|---|---|---|---|---|
| 2.1.0 | Yes | Yes | Unsupported | Unsupported |
| 2.2.3 | Yes | Yes | Yes | Yes |
| Local a77f | Yes | Yes | Yes | Yes |

`parallel` is Rspack's loader execution flag. `cache` means loader `use.cache`; Rspack 2.1.0 predates that API and its cache-on groups are recorded as unsupported. Babel's own `cacheDirectory` stays false. `babel-loader@10.1.1` / `@babel/core@7.29.7` parse and print every input without presets, plugins, external configuration, source maps or minification.

[config.mjs](config.mjs) uses development mode with optimizations and incremental builds disabled. On 2.2.3 and local, memory is the storage backend and the cache layers are explicitly restricted to:

```js
cache: { type: 'memory' },
experiments: {
  newCache: {
    module: false,
    codeGeneration: false,
    devtool: false,
    minimize: false,
    loader: true,
  },
},
```

The loader's `cache` flag is switched independently of `parallel`. Rspack 2.1.0 uses `cache: false` and omits the unavailable newCache options. There is no persistent cache or filesystem watcher. `RSPACK_LOADER_WORKER_THREADS` can override pool size on all three versions; otherwise each implementation uses its default.

Each fresh process creates one compiler and performs a cold build followed by a full rebuild with unchanged source contents. Before rebuilding, every resource is marked modified. All 10,000 modules must report `built: true` on both builds, preventing module reuse from being mistaken for loader-cache hits. The compiler and worker pool stay alive between the two builds. Every group has one validation pair, one warmup pair, and five measured pair attempts, executed serially with rotating group order. Failed pairs are retained, excluded from timing distributions, and never automatically retried. Reports show successful sample counts.

[audit-preload.cjs](audit-preload.cjs) instruments the actual Babel loader and transform function in the main thread and worker threads, only during validation. Cold builds and cache-off rebuilds must invoke both exactly 10,000 times. Cache-on rebuilds must invoke neither, while all modules still rebuild. Validation checks execution thread IDs and the complete resource set. Every measured build checks module counts, exact loader chains, unchanged output hashes within each version, and the exported sum of 49,995,000.

Build timing covers `compiler.run()` through its callback; compiler setup/close, stats, audits, bundle execution and hashing are excluded. The cold build includes initial worker startup; the rebuild uses the existing pool. Compare cache on/off within the same parallel setting and build state to assess cache savings. Cold-to-warm changes also include worker/JIT/OS warmup.

Results go to `results/babel-loader-parallel-cache-<session>/`, with raw records, phase timings, validation logs, effective cache settings, fixture hashes, dependency/native/worker hashes, benchmark sources and the local worktree patch. `results/latest-babel-loader-parallel-cache.txt` points to the latest completed run.

A run with recorded outcomes can be continued with `--resume results/<run>`. Existing records, including failures, are retained; only unattempted pairs run. A job without a result requires its failure/interruption to be recorded before resuming. Source revisions are snapshotted separately, and fixture/config/dependency/local-patch hashes must remain unchanged.

## Recorded results

[10,000-module run from September 12, 2026](results/babel-loader-parallel-cache-2026-09-12T00-27-06-288Z-16/README.md), including cold/full-rebuild timings and the local parallel/cache-on failures.

[Main-thread bridge diagnostic](results/loader-main-bridge-diagnostic-2026-09-12/README.md): the local parallel/cache-off cold build and full rebuild issue 20,001 options requests for one handle. Instrumented timings are excluded from the performance results.
