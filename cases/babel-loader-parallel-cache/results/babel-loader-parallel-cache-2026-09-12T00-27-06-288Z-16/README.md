# Babel loader parallel / cache results: September 12, 2026

`pnpm bench:babel-loader-parallel-cache --modules 10000 --runs 5`

The existing 10,000-module fixture is reused. Local means `/data00/home/jinzhixin/.codex/worktrees/a77f/rspack`, whose compiled artifact reports 2.2.1. Every sample starts a fresh process/compiler, then rebuilds all 10,000 modules in the same compiler with unchanged content. Default parallelism is 31 workers.

Only the new Rspack loader cache is enabled: `newCache.loader: true` with `module`, `codeGeneration`, `devtool`, and `minimize` all false. `use.cache` is toggled per group. Its memory backend stays enabled for 2.2.3/local; legacy caching is off in 2.1.0, which does not support loader `use.cache`. Babel cacheDirectory, babelrc and configFile are false. Development mode, disabled optimizations and incremental:false apply throughout.

**2 pair(s) failed. Failed attempts were retained and never retried. Timing medians include only completed pairs; sample counts are shown below.**

Median build time in milliseconds, **cold / full rebuild**. Each supported combination has five measured attempts.

| Version | parallel off / cache off | parallel on / cache off | parallel off / cache on | parallel on / cache on |
|---|---:|---:|---:|---:|
| v2-1-0 | 6363.28 / 5153.13 (5/5) | 5109.39 / 3722.05 (5/5) | Unsupported | Unsupported |
| v2 | 6799.62 / 5159.90 (5/5) | 5570.35 / 3635.68 (5/5) | 6490.02 / 1108.92 (5/5) | 6845.59 / 3827.36 (5/5) |
| worktree-a77f | 7000.30 / 5316.59 (5/5) | 4296.07 / 2312.21 (5/5) | 6584.63 / 1353.28 (5/5) | 4532.24 / 1892.34 (3/5) |

## Failures

- `worktree-a77f-parallel-on-cache-on-measure-3`: cold, 427 module errors. See [evidence](failure-evidence/worktree-a77f-parallel-on-cache-on-measure-3/) and [raw record](raw/worktree-a77f-parallel-on-cache-on-measure-3.json).
- `worktree-a77f-parallel-on-cache-on-measure-4`: cold, 434 module errors. See [evidence](failure-evidence/worktree-a77f-parallel-on-cache-on-measure-4/) and [raw record](raw/worktree-a77f-parallel-on-cache-on-measure-4.json).

The failed local parallel/cache-on cold builds reported `The original reference that WeakReference<rspack_binding_api::compilation::JsCompilation> is pointing to is dropped`. Per-attempt module error counts are listed above. No Rspack source or compiled artifacts were changed in response. The runner was extended to retain failures and continue unattempted pairs; original samples and source snapshots were preserved. Resumed runner snapshots and hashes are listed in metadata.json. This run measures performance conditional on completion and also exposes a reliability problem.

136 builds completed in successful pairs; 2 pair(s) failed among 70 validation/warmup/measurement attempts. The two unsupported 2.1.0 cache-on records have no performance samples. All 10 validation pairs pass: every cold/cache-off validation build invokes Babel and its loader exactly 10,000 times on the expected thread(s). Every cache-on validation rebuild invokes both zero times while still rebuilding every module. This confirms loader-cache hits without module-cache reuse. Measured builds contain no loader/Babel counters or buildModule taps.

Every successful output exports 49,995,000 and its hash matches across settings/repetitions within its version. Build timing excludes setup, close, stats, audit logging, output execution and hashing. Cold timings include initial worker startup; rebuilds retain the worker pool and runtime/JIT warmup. Assess cache savings by on/off comparisons in the same state rather than cold-to-warm changes alone.

- [report.md](report.md): complete timing ranges, sample and validation counts.
- [summary.json](summary.json): all sample distributions and failures.
- [raw/](raw/): 72 process records, including effective cache options and artifact hashes.
- [failures.json](failures.json), [failure-evidence/](failure-evidence/): failed attempts, module errors and logs.
- [unsupported.json](unsupported.json): the two unsupported 2.1.0 combinations.
- [metadata.json](metadata.json), [fixture.json](fixture.json): run settings, source and input hashes.
- [source/](source/), [worktree.patch](worktree.patch): original benchmark source and local implementation patch.

Raw records are archived unchanged. Complete stats, per-thread validation logs, emitted files and process logs remain in the ignored run directory. These are descriptive samples; OS caches and background machine activity are uncontrolled.
