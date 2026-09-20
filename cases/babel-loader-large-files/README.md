# Babel loader with large source files

Compares published **Rspack 2.2.6** with the release build of `codex/loader-runner-mpmc` in worktree `bec7`. The default runs `parallel: true` on 10,000 modules with at least 1,200 lines each, using the same explicit worker count for both versions. Optional main-thread controls are available with `--include-main`.

```bash
# Build the branch before measuring; do not build or run other benchmarks concurrently.
cd /data00/home/jinzhixin/.codex/worktrees/bec7/rspack
pnpm run build:cli:release

cd /home/jinzhixin/projects/rspack-bench
pnpm install --frozen-lockfile
pnpm bench:babel-loader-large-files --modules 10000 --lines 1200 --workers 8 --runs 5
```

For a smoke run, use `--modules 24 --workers 2 --runs 1`. `--generate-only` writes the fixture without loading either compiler. `--lines` sets a minimum: function blocks and dependency imports make actual files slightly longer.

The shared [generator](../babel-loader/case.mjs) accepts `linesPerModule`. Large modules contain data-processing functions with objects, destructuring, arrays, arrow functions, optional chaining and nullish coalescing. Every function executes in the emitted bundle and contributes to a checksum propagated through the binary-tree dependency graph. Source size comes from executable code. Existing small-file cases retain their original inputs; large-file runs always generate their own fixture. The manifest records line counts, bytes and source hashes.

Babel versions are pinned to `babel-loader@10.1.1` and `@babel/core@7.29.7`. Babel parses and prints the full input without presets/plugins. This isolates large-input loader execution, rather than representing a particular production Babel preset stack. Bundler mode is development with minification and other optimization flags disabled; the compiler binaries are release builds. Rspack cache, incremental builds, loader `use.cache`, Babel `cacheDirectory`, external Babel configuration and source maps are disabled.

```text
bench.mjs
  generate the shared large-file graph; snapshot source, lockfile and worktree revision
       ↓
run-build.mjs (fresh Node process for each sample)
  resolve the exact core/native artifacts and hash them
       ↓
createConfig → rspack(config)
  Babel main / parallel; fixed RSPACK_LOADER_WORKER_THREADS
       ↓
compiler.run
  cold build, including outstanding worker startup
       ↓
mark all fixture resources modified → compiler.run
  full rebuild; same compiler/pool, every module executes Babel again
       ↓
validate module set, loader chain, output checksum and hashes
  save raw records → compare repeated samples
```

Each selected group gets one validation pair, one discarded warmup pair, and five measured pairs by default. Samples run serially with rotating group order. OS caches are retained. During validation only, the existing [audit preload](../babel-loader-parallel-cache/audit-preload.cjs) counts the actual loader and Babel transform calls and records worker thread IDs. It must observe exactly one of each per module in both builds and the correct execution thread. Measured runs have no audit preload.

Build timing spans `compiler.run` through its callback. The report also shows **compiler setup + cold build**, since the branch starts workers during compiler setup. Stats serialization, bundle evaluation, hashing and compiler close are outside build timing. Full process timings in raw results include those operations and are not pure compilation measurements. The default compares parallel Babel on both versions. Add `--include-main` for main-thread controls. Both versions use eight workers by default for this case, independent of their different automatic defaults; adjust `--workers` to compare other pool sizes.

Every build validates all modules were built, checks the exact Babel loader chain, and checks stable output hashes within each version. Cold validation builds evaluate the exported sum and generated-function checksum in a separate Node process (24 GiB heap limit); full rebuilds and measured runs must match that validated output hash. Streaming hashes and validation in a subprocess avoid parsing a roughly 500 MiB bundle inside the timed compiler's JS heap. Validation failures stop the measurement phase. Failed samples remain recorded and are not retried or silently replaced. A filesystem lock prevents overlap with other cases in this repository.

Results are written under `results/babel-loader-large-files-<timestamp>/`; `results/latest-babel-loader-large-files.txt` names the latest completed run. The report, raw samples, environment, artifact hashes, source snapshot, lockfile, fixture manifest, invocation audit and stats are preserved. Whole-version differences include other changes since 2.2.6, so results alone do not isolate the effect of the task queue.

## Recorded results

[10,000-module comparison, September 20, 2026](results/babel-loader-large-files-2026-09-20T08-45-53-242Z-2631384/README.md).
