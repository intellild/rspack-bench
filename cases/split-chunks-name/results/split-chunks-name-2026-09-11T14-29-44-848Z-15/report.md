# splitChunks.name benchmark

Development; only splitChunks enabled; other optimizations, cache and incremental builds disabled; no loaders. Serial fresh Node processes; rotating measurement order; OS cache retained.

10000 JS modules, extracted into one shared chunk. Static name "shared" versus a callback returning "shared". One validation, one warmup and 5 measured builds per supported group.

Worktree: /data00/home/jinzhixin/.codex/worktrees/a77f/rspack. HEAD: bbb58b8516649f14c896399db802031151bb0057. Status: M crates/node_binding/napi-binding.d.ts
 M crates/rspack_binding_api/src/raw_options/raw_split_chunks/mod.rs
 M crates/rspack_binding_api/src/raw_options/raw_split_chunks/raw_split_chunk_name.rs
 M crates/rspack_binding_api/src/worker.rs
 M packages/rspack/src/Compiler.ts
 M packages/rspack/src/builtin-plugin/SplitChunksPlugin.ts
 M packages/rspack/src/loader-runner/service.ts
 M packages/rspack/src/loader-runner/worker.ts
 M packages/rspack/src/workerFunction.ts
 M website/docs/en/api/javascript-api/worker-function.mdx
 M website/docs/zh/api/javascript-api/worker-function.mdx
?? tests/rspack-test/compilerCases/fixtures/worker-function-split-chunks/
?? tests/rspack-test/compilerCases/worker-function-split-chunks.js. Actual compiled artifacts are identified by the recorded hashes.

workerFunction: executed; see the worker group. See worker-function-status.json.

| Version / mode | Package / compiled | Name calls | Callback turns |
|---|---|---:|---:|
| v2-1-0 / static | 2.1.0 / 2.1.0 | 0 | 0 |
| v2 / static | 2.2.3 / 2.2.3 | 0 | 0 |
| worktree-a77f / static | 2.2.1 / 2.2.1 | 0 | 0 |
| v2-1-0 / callback | 2.1.0 / 2.1.0 | 10000 | 10000 |
| v2 / callback | 2.2.3 / 2.2.3 | 10000 | 80 |
| worktree-a77f / callback | 2.2.1 / 2.2.1 | 10000 | 10000 |
| worktree-a77f / worker | 2.2.1 / 2.2.1 | 10000 | — |

Times in milliseconds: median [min, max].

| Version / mode | Build | make | finishMake | seal | emit | Process |
|---|---:|---:|---:|---:|---:|---:|
| v2-1-0 / static | 349.30 [335.87, 367.37] | 131.73 [121.96, 151.16] | 14.63 [14.24, 15.26] | 153.05 [146.73, 153.88] | 28.02 [25.21, 29.74] | 2927.27 [2900.33, 2947.76] |
| v2 / static | 367.34 [333.63, 390.69] | 133.35 [104.98, 144.94] | 14.86 [14.43, 15.62] | 167.59 [157.76, 184.01] | 26.85 [26.23, 28.55] | 2958.37 [2848.26, 3020.26] |
| worktree-a77f / static | 354.53 [339.84, 388.42] | 128.98 [115.62, 153.00] | 14.16 [13.98, 15.26] | 158.67 [156.71, 169.10] | 26.48 [23.07, 29.00] | 3012.98 [2892.91, 3052.29] |
| v2-1-0 / callback | 768.38 [744.98, 794.93] | 130.26 [124.45, 139.02] | 14.76 [14.20, 15.12] | 571.13 [556.12, 586.16] | 27.10 [26.60, 29.17] | 3401.43 [3367.99, 3460.18] |
| v2 / callback | 681.49 [662.82, 700.53] | 126.28 [113.23, 134.61] | 15.05 [14.90, 15.53] | 480.66 [476.73, 502.62] | 26.72 [24.67, 27.56] | 3316.51 [3268.64, 3378.79] |
| worktree-a77f / callback | 782.94 [755.05, 789.97] | 124.09 [109.43, 135.77] | 15.49 [15.11, 16.43] | 577.62 [565.19, 593.98] | 26.82 [24.31, 29.10] | 3367.89 [3244.12, 3466.50] |
| worktree-a77f / worker | 692.61 [682.40, 699.43] | 263.62 [242.54, 295.23] | 14.66 [13.93, 15.28] | 298.69 [296.53, 304.41] | 23.10 [22.72, 25.90] | 3347.37 [3325.94, 3400.25] |

| Version / mode | Incremental build cost | Incremental seal cost | Build / static |
|---|---:|---:|---:|
| v2-1-0 / callback | 419.08 ms | 418.08 ms | 2.200× |
| v2 / callback | 314.15 ms | 313.07 ms | 1.855× |
| worktree-a77f / callback | 428.41 ms | 418.95 ms | 2.208× |
| worktree-a77f / worker | 338.07 ms | 140.02 ms | 1.954× |

Build timing: compiler.run invocation to callback, excluding setup/close, stats, bundle execution and artifact hashing. Seal covers seal → afterSeal and includes splitChunks, module/chunk IDs, code generation and other sealing work. It does not isolate splitChunks alone.

Validation counts name invocations and microtask turns, checks every callback resource and argument shape, exact loader-free module counts, shared-chunk membership, and the exported sum. Instrumentation is absent from measured callbacks. Outputs must match across naming modes and repetitions within each version. Loaded artifacts remain unchanged throughout the run.

Differences compare whole builds and describe this synthetic graph. Samples and ranges are descriptive rather than a significance test; background machine activity and OS caches are uncontrolled.

Raw configs, versions, environment and timings: raw/. Stats: stats/. Fixture hashes: fixture.json. Source/lock hashes: metadata.json. Source snapshot: source/. Outputs: output/. Logs: logs/.
