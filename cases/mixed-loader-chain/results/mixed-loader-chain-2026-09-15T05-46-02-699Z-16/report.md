# Mixed JS loader chain benchmark

Development; all optimizations, all caches and incremental builds disabled. Three synchronous noop JS loaders. main=[false,false,false], mixed=[false,true,false], parallel=[true,true,true] in configured use order; normal execution runs right to left. Default worker count unless overridden in environment.

Each fresh process creates one compiler: cold build, then full rebuild with unchanged contents and all resources marked modified. Each measured pair starts in a fresh process. The full rebuild reuses the compiler and any workers; all three loaders must run again on every module. Serial processes; rotating group order; OS cache retained.

10000 modules; one validation pair, one warmup pair and 5 measured attempts per validated group. 120 builds in successful pairs; 3 failed pairs, never automatically retried.

Milliseconds: median [min, max]. The warm state is a full rebuild with every resource marked modified and all caching disabled.

| Version | Mode | Cold build | Full rebuild | Cold make | Warm make | Pair process | Successful / attempted measured pairs |
|---|---|---:|---:|---:|---:|---:|---:|
| v2-1-0 | main | 1660.59 [1626.41, 1792.16] | 1204.09 [1155.33, 1263.96] | 1429.01 [1415.32, 1573.97] | 900.12 [865.63, 963.53] | 6833.04 [6703.33, 6968.32] | 5 / 5 |
| v2-1-0 | mixed | 4100.19 [4062.15, 4196.35] | 3359.23 [3282.89, 3417.82] | 3886.64 [3852.43, 3984.71] | 3086.41 [2978.83, 3133.80] | 11665.01 [11453.85, 11772.02] | 5 / 5 |
| v2-1-0 | parallel | 4192.01 [4090.44, 4228.72] | 3327.95 [3290.92, 3436.06] | 3981.58 [3880.56, 4019.23] | 3028.79 [2999.09, 3152.62] | 11706.23 [11630.05, 11750.85] | 5 / 5 |
| v2 | main | 1783.96 [1730.54, 1843.85] | 1164.64 [1129.51, 1175.18] | 1564.34 [1509.74, 1605.51] | 981.73 [949.69, 991.82] | 6972.85 [6837.72, 7124.03] | 5 / 5 |
| v2 | mixed | 4440.25 [4328.45, 4620.16] | 3431.19 [3302.24, 3514.54] | 4233.04 [4126.82, 4405.39] | 3248.15 [3124.56, 3338.33] | 12118.03 [12099.73, 12240.15] | 5 / 5 |
| v2 | parallel | 4178.87 [4126.59, 4385.64] | 3217.87 [3142.08, 3375.98] | 3964.41 [3916.28, 4174.22] | 3029.40 [2973.03, 3187.50] | 11707.76 [11580.09, 12081.73] | 5 / 5 |
| worktree-a77f | main | 1933.23 [1899.44, 2054.23] | 1330.41 [1290.03, 1581.18] | 1727.73 [1702.42, 1854.73] | 1146.65 [1118.33, 1385.57] | 7674.44 [7521.93, 8143.21] | 5 / 5 |
| worktree-a77f | mixed | 5126.01 [5099.55, 5314.90] | 4379.67 [4323.41, 4523.60] | 4927.91 [4896.14, 5111.21] | 4203.62 [4142.25, 4341.27] | 14384.09 [14117.85, 14400.51] | 3 / 5 |
| worktree-a77f | parallel | 3233.70 [3174.16, 3506.29] | 2672.50 [2540.36, 2821.34] | 3036.70 [2974.16, 3300.62] | 2489.71 [2365.51, 2638.00] | 10594.87 [10392.86, 11060.30] | 5 / 5 |

| Version / mode | Cold build delta vs main | Full rebuild delta vs main |
|---|---:|---:|
| v2-1-0 / mixed | 2439.61 ms (2.469×) | 2155.14 ms (2.790×) |
| v2-1-0 / parallel | 2531.42 ms (2.524×) | 2123.86 ms (2.764×) |
| v2 / mixed | 2656.30 ms (2.489×) | 2266.56 ms (2.946×) |
| v2 / parallel | 2394.91 ms (2.342×) | 2053.24 ms (2.763×) |
| worktree-a77f / mixed | 3192.78 ms (2.652×) | 3049.26 ms (3.292×) |
| worktree-a77f / parallel | 1300.48 ms (1.673×) | 1342.09 ms (2.009×) |

Failed pairs are retained and excluded from timing distributions. Consult failure counts alongside successful-sample medians.

- worktree-a77f-parallel-warmup-0:   × Module build failed (from ../../../cases/mixed-loader-chain/loaders/right.cjs):
  ╰─▶   × Error: The original reference that WeakReference<rspack_binding_api::compilation::JsCompilation> is pointing to is dropped
        │     at file://~/.codex/worktrees/a77f/rspack/packages/rspack/dist/worker.js:3903:69
        │     at runWorkerLoop (file://~/.codex/worktrees/a77f/rspack/packages/rspack/dist/worker.js:3907:18)
- worktree-a77f-mixed-measure-2:   × Module build failed (from ../../../cases/mixed-loader-chain/loaders/middle.cjs):
  ╰─▶   × Error: The original reference that WeakReference<rspack_binding_api::compilation::JsCompilation> is pointing to is dropped
        │     at file://~/.codex/worktrees/a77f/rspack/packages/rspack/dist/worker.js:3903:69
        │     at runWorkerLoop (file://~/.codex/worktrees/a77f/rspack/packages/rspack/dist/worker.js:3907:18)
- worktree-a77f-mixed-measure-4:   × Module build failed (from ../../../cases/mixed-loader-chain/loaders/middle.cjs):
  ╰─▶   × Error: The original reference that WeakReference<rspack_binding_api::compilation::JsCompilation> is pointing to is dropped
        │     at file://~/.codex/worktrees/a77f/rspack/packages/rspack/dist/worker.js:3903:69
        │     at runWorkerLoop (file://~/.codex/worktrees/a77f/rspack/packages/rspack/dist/worker.js:3907:18)

| Validation group | Cold calls per loader | Warm calls per loader | Resources with correct order (cold / warm) |
|---|---|---|---|
| v2-1-0-main | 10000 / 10000 / 10000 | 10000 / 10000 / 10000 | 10000 / 10000 |
| v2-1-0-mixed | 10000 / 10000 / 10000 | 10000 / 10000 / 10000 | 10000 / 10000 |
| v2-1-0-parallel | 10000 / 10000 / 10000 | 10000 / 10000 / 10000 | 10000 / 10000 |
| v2-main | 10000 / 10000 / 10000 | 10000 / 10000 / 10000 | 10000 / 10000 |
| v2-mixed | 10000 / 10000 / 10000 | 10000 / 10000 / 10000 | 10000 / 10000 |
| v2-parallel | 10000 / 10000 / 10000 | 10000 / 10000 / 10000 | 10000 / 10000 |
| worktree-a77f-main | 10000 / 10000 / 10000 | 10000 / 10000 / 10000 | 10000 / 10000 |
| worktree-a77f-mixed | 10000 / 10000 / 10000 | 10000 / 10000 / 10000 | 10000 / 10000 |
| worktree-a77f-parallel | 10000 / 10000 / 10000 | 10000 / 10000 / 10000 | 10000 / 10000 |

Timing: compiler.run invocation to callback; setup/close, stats, audits, bundle evaluation and hashing excluded. Process timing covers the entire two-build child process.

Validation-only preload counters verify exactly 10,000 invocations of each of three independent loader files, every resource, right-to-left execution order, and main/worker thread placement on both builds. Measured builds contain no invocation counters or buildModule taps. All builds validate freshly built module counts, the three-loader chain, output hashes and exported sum. Outputs match across modes and repetitions within each version.

Local a77f prewarms its pool when Rspack loads and waits before native worker builds. Artifact hashing and setup are outside build timing and may overlap startup; process timing includes the entire pair, loading, validation, stats compression, and shutdown. No claim is made that build-time deltas equal end-to-end savings. Warm rebuilds reuse workers and runtime state, but no module or loader results.

Noops measure orchestration and thread-transition cost, not useful transform throughput. Ordinary filesystem/OS/runtime caches are not flushed. Samples and ranges are descriptive; background activity is uncontrolled.

Raw records: raw/. Compressed stats: stats/. Validation invocation logs: audit/. Source snapshots: source/. Worktree patch: worktree.patch. Fixture hashes: fixture.json.
