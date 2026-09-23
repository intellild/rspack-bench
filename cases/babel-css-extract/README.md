# Parallel Babel + CSS extraction

Compare published Rspack **2.2.6** with a release build of **codex/loader-runner-mpmc**. Defaults: **10,000 JS modules**, **1,200+ executable lines per JS**, **one CSS Module per JS**, **8 Babel workers**, and **five measured samples per version**. Babel parses/prints without presets or plugins. CSS uses real css-loader and CssExtractRspackPlugin on the main thread.

```sh
pnpm install --no-frozen-lockfile
pnpm bench:babel-css-extract
# Small validation, including native overhead logs:
pnpm bench:babel-css-extract --modules 24 --workers 4 --diagnostic-only
# Generate inputs only:
pnpm bench:babel-css-extract --generate-only
```

Build the local release binding before testing (`pnpm run build:binding:release` in the Rspack worktree). `versions/worktree-bec7` points to that worktree; `versions/v2-2-6` pins the baseline. Both pin babel-loader 10.1.1, @babel/core 7.29.7 and css-loader 7.1.5. The current diagnostic preload uses Node 24's synchronous `module.registerHooks` to instrument the ESM extract loader.

```text
fixture.mjs + ../babel-loader/case.mjs
  Binary-tree graph of 10,000 large JS modules
  Each JS imports and checks a dedicated .module.css export
       ↓
config.mjs
  JS: babel-loader, parallel: true
  CSS: CssExtractRspackPlugin.loader → css-loader, parallel: false
       ↓
CSS extract pitch
  importModule → nested css-loader build → extracted CSS dependency
       ↓
run-build.mjs
  main.cjs + main.css; validate exports, classes, rules and module counts
```

Each CSS file has a unique class and three rules (base, hover, child span). The JS checks its named CSS export. Evaluating the root JS exports checks all generated JS functions and all CSS class imports. Every build checks 10,000 freshly built Babel modules, 10,000 CSS proxy modules, 10,000 extracted CSS modules, the exact loader chains, all CSS rules, and stable JS/CSS output hashes. Diagnostic builds additionally verify 10,000 actual calls each to Babel, css-loader, and extract pitch, including their execution threads. Nested CSS builds are separately identified by full module identifier.

Each version runs one diagnostic pair, one discarded warmup pair, then five measured pairs in alternating version order. Each pair uses a fresh process/compiler for a cold build, then forces a full rebuild with every JS/CSS resource marked modified. Rspack caches, loader caches, Babel disk/config caches, incremental compilation and bundler optimizations are disabled. OS caches are retained. Runs are serial. Failures are retained without automatic retries.

Performance measures `compiler.run` through its callback. Setup + cold also includes compiler creation because worker initialization can start there. Stats, output hashing, CSS validation, bundle evaluation and compiler close are outside this interval. Diagnostic bundle evaluation runs in a separate Node process. Formal builds have no loader wrappers, module lifecycle hooks or native timing file.

## Overhead logs

Diagnostic builds write `audit/js-*.jsonl` for actual Babel loader body, nested Babel transform, css-loader normal and extract pitch. The branch also writes `audit/native.jsonl` with `RSPACK_LOADER_TIMING_FILE`. Native points cover:

```text
Rust loader_yield: before boxed context move
  → enqueue → receive → TSFN callback entry
  → takeContext enter → Rust context ready
  → complete enter → result returned → Rust context restored
```

`diagnostics.mjs` joins each resource's cold/rebuild invocation with its native task and module lifecycle. It verifies task phase, routing, counts and thread IDs. `diagnostics.md` reports p50/p95/max; JSON additionally includes mean and sum. The worker callback awaits `prepareWorkerTask` RPC on main before `takeContext`; this wait is included in “callback + main prepare”. The current branch skips the NormalModule loader hook for worker tasks and returns the API bridge data in that same response. It no longer performs a second synchronous getMainObject request. Older result snapshots retain their original hook/bridge behavior. N-API conversion, runner work and RPC inside the JS interval are part of its residual after subtracting the actual body.

All these durations are latency, including waits. Concurrent task sums overlap. Extract pitch contains the nested CSS loader build, and Babel body contains transform; do not add nested intervals or interpret residuals as pure CPU overhead. Instrumented runs perturb contention and are excluded from performance medians. Whole-version differences cannot isolate queue dispatch as the sole cause.

Results are saved under `results/babel-css-extract-*`; the latest complete run is recorded in `results/latest-babel-css-extract.txt`. The report includes samples/ranges, source and binary hashes, exact source snapshots, local native instrumentation patch, raw logs, per-task timings, full stats and fixture hashes.

## Recorded results

[10,000-module mixed comparison](results/babel-css-extract-2026-09-20T10-02-46-716Z-2661908/README.md).

## Recorded results

[10,000-module mixed comparison](results/babel-css-extract-2026-09-20T11-37-49-482Z-2750617/README.md).
