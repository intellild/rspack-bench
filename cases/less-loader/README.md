# Less loader overhead

Compares Rspack 2.2.3 and `/data00/home/jinzhixin/.codex/worktrees/0385/rspack` using `less-loader@13.0.0` and `less@4.9.1`, against equivalent CSS requiring no loader.

```bash
pnpm install --frozen-lockfile
pnpm bench:less-loader --modules 10000 --runs 5
```

The workload is 10,000 stylesheets plus one JS entry importing them all. Existing Less inputs under `fixture/styles/` are reused when available; otherwise equivalent inputs are generated. Each stylesheet contains variables, a mixin, nested selectors, and arithmetic, producing three rules with three declarations each. Matching CSS is precompiled once outside build timers for the baseline.

| Pipeline | Input | Processing |
|---|---|---|
| Baseline | Precompiled CSS | Native CSS |
| Loader | Less | less-loader → native CSS |

Only less-loader runs on the Less path; there is no css-loader, extraction plugin, or additional NormalModule loader hook. Source maps, parallel loaders, caching, incremental builds, and configurable optimizations are disabled in development mode. Less uses `math: 'parens-division'` in both precompilation and timed builds. See the [less-loader options](https://webpack.js.org/loaders/less-loader/#options).

[case.mjs](case.mjs) defines the fixture, configuration, and validation. Every group runs one validation, one warmup, and five measured builds in fresh Node processes, serially in rotating order. Validation checks all 10,000 stylesheet modules, exact loader chains, every less-loader and Less render invocation, the bundle export, and all 30,000 CSS rules and their declarations. Instrumentation is absent from measured builds. Emitted CSS must match the precompiled baseline byte for byte, and outputs must agree between versions and across repetitions.

Overhead is median build time with Less minus the precompiled CSS baseline. It includes Less compilation and loader/Rust-JS integration, so it is not directly comparable to noop-only scheduling cost. Build timing excludes fixture precompilation, compiler setup/close, stats, output checks, and hashing. The [shared runner](../../lib/loader-overhead/bench.mjs) records samples, phase timings, effective configurations, dependency versions, worktree state, and artifact hashes.

Generated results are under `results/less-loader-<session>/`; `results/latest-less-loader.txt` points to the latest completed run. Each run contains an exact benchmark source snapshot.

## Recorded results

[10,000-module comparison from September 11, 2026](results/less-loader-2026-09-11T04-19-17-597Z-15/README.md), including all samples and the matching source snapshot.
