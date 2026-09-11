# Babel loader overhead

Compares Rspack 2.2.3 and `/data00/home/jinzhixin/.codex/worktrees/0385/rspack` with no loader versus `babel-loader@10.1.1` and `@babel/core@7.29.7`.

```bash
pnpm install --frozen-lockfile
pnpm bench:babel-loader --modules 10000 --runs 5
```

The case reuses the existing 10,000-module noop JS fixture when available. Otherwise it generates the same binary-tree import graph. Babel parses and prints every module without presets or plugins. External Babel configuration, Babel caching, source maps, and minification are disabled. This measures Babel's basic pipeline, not preset-env or JSX transformation. See the [babel-loader options](https://webpack.js.org/loaders/babel-loader/#options).

[case.mjs](case.mjs) defines the fixture, configuration, and validation. The two versions are selected through `versions/v2` and `versions/worktree-0385`. Both use development mode with configurable optimizations, caching, incremental builds, and parallel loaders disabled. No NormalModule loader hook is registered.

Every group has one validation, one warmup, and five measured builds in fresh Node processes, running serially in rotating order. All builds use 10,000 workload modules by default. Validation checks every loader and Babel compiler invocation, resource, exact loader chain, and the exported sum. Measured builds contain no instrumentation. Output hashes must agree across repetitions and versions within each pipeline.

Overhead is median build time with Babel minus the no-loader baseline. It includes Babel parsing/code generation, loader resolution, and Rust/JS scheduling. Build timing excludes compiler setup/close, stats, bundle validation, and hashing. The [shared runner](../../lib/loader-overhead/bench.mjs) records phase timings, all samples, effective configurations, worktree state, loaded dependency versions, and source/native artifact hashes.

Generated results are under `results/babel-loader-<session>/`; `results/latest-babel-loader.txt` points to the latest completed run. Each run contains an exact benchmark source snapshot.

## Recorded results

[10,000-module comparison from September 11, 2026](results/babel-loader-2026-09-11T04-14-10-858Z-15/README.md), including all samples and the matching source snapshot.
