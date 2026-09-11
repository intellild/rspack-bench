# Noop JS loader overhead

Compares published Rspack 2.2.3 with the compiled worktree at `/data00/home/jinzhixin/.codex/worktrees/0385/rspack`, linked through the `versions/worktree-0385` pnpm workspace package.

```bash
pnpm install --frozen-lockfile
pnpm bench:noop-loader --modules 10000 --runs 5
```

The default fixture contains 10,000 plain JavaScript modules connected by binary-tree imports, including the entry. Every group uses the same files. The bundle exports the sum of module values, checked after every build.

| Version | Baseline | Loader comparison |
|---|---|---|
| 2.2.3 | No loader | One noop JS loader per module |
| worktree-0385 | No loader | One noop JS loader per module |

[config.mjs](config.mjs) uses development mode with source maps, caching, incremental builds, parallel loaders, and configurable optimizations disabled. It registers no `NormalModule` loader hook and uses no React, CSS, or builtin loaders. The only pipeline difference is `use: []` versus one `loaders/noop.cjs`.

Each group runs one validation, one warmup, and five measured builds by default. All builds run serially in fresh Node processes, with rotating measurement order and OS caches retained. Build timing covers `compiler.run()` through its callback; compiler setup/close, stats, bundle execution, and artifact hashing are excluded. Process lifetime and make, finishMake, seal, and emit intervals are reported separately.

Validation checks the exact module count and loader chain, zero baseline loader calls or exactly one noop call per module, and the exported sum. Counters are enabled only during validation. Output hashes must match across repetitions within each version and pipeline. The worker verifies that the local JS core, binding entry, and native binary all come from the specified worktree and records their hashes, rejecting artifact changes between builds.

Loader overhead is the difference between the median build time with noop and without loaders, computed separately for each version. The report compares those differences and shows the amortized overhead per module. These are whole-build measurements, including loader resolution and Rust/JS scheduling; they do not measure one internal function in isolation.

Generated results go to `results/noop-loader-<session>/`, with a report, summary, all worker records, fixture hashes, detailed stats, outputs, logs, worktree revision/status, and an exact benchmark source snapshot. `results/latest-noop-loader.txt` points to the latest completed run.

## Recorded results

The [10,000-module run from September 11, 2026](results/noop-loader-2026-09-11T04-04-10-528Z-15/README.md) records 1,116.62 ms of loader overhead for 2.2.3 and 1,120.34 ms for worktree `0385`, a difference of 3.72 ms (0.33%).
