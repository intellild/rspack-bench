# splitChunks.name benchmark

Development; only splitChunks enabled; other optimizations, cache and incremental builds disabled; no loaders. Serial fresh Node processes; rotating measurement order; OS cache retained.

10000 JS modules, extracted into one shared chunk. Static name "shared" versus a callback returning "shared". One validation, one warmup and 5 measured builds per supported group.

Worktree: /data00/home/jinzhixin/.codex/worktrees/a77f/rspack. HEAD: bbb58b8516649f14c896399db802031151bb0057. Status: clean. Actual compiled artifacts are identified by the recorded hashes.

workerFunction: unsupported in splitChunks.name by the loaded a77f build; no worker timing is reported. See worker-function-status.json.

| Version / mode | Package / compiled | Name calls | Callback turns |
|---|---|---:|---:|
| v2-1-0 / static | 2.1.0 / 2.1.0 | 0 | 0 |
| v2 / static | 2.2.3 / 2.2.3 | 0 | 0 |
| worktree-a77f / static | 2.2.1 / 2.2.1 | 0 | 0 |
| v2-1-0 / callback | 2.1.0 / 2.1.0 | 10000 | 10000 |
| v2 / callback | 2.2.3 / 2.2.3 | 10000 | 80 |
| worktree-a77f / callback | 2.2.1 / 2.2.1 | 10000 | 10000 |

Times in milliseconds: median [min, max].

| Version / mode | Build | make | finishMake | seal | emit | Process |
|---|---:|---:|---:|---:|---:|---:|
| v2-1-0 / static | 345.56 [327.39, 374.25] | 129.80 [120.32, 154.91] | 15.03 [14.45, 15.98] | 154.63 [142.41, 157.61] | 25.00 [23.81, 27.32] | 2887.26 [2825.78, 2992.92] |
| v2 / static | 352.31 [325.35, 367.60] | 128.85 [107.86, 137.59] | 14.66 [14.49, 15.60] | 159.27 [147.80, 161.46] | 25.35 [23.90, 27.76] | 2857.77 [2826.78, 2862.76] |
| worktree-a77f / static | 350.10 [341.75, 359.21] | 118.37 [109.33, 132.16] | 14.29 [14.05, 16.22] | 163.74 [156.50, 166.14] | 25.47 [24.74, 26.87] | 2850.84 [2838.26, 2939.98] |
| v2-1-0 / callback | 741.67 [732.31, 767.95] | 131.49 [125.75, 151.40] | 14.81 [14.47, 15.43] | 547.31 [539.04, 556.41] | 25.67 [24.64, 27.09] | 3254.92 [3237.47, 3375.61] |
| v2 / callback | 651.60 [648.92, 683.01] | 114.55 [105.75, 129.03] | 15.01 [14.51, 15.51] | 475.17 [468.78, 496.32] | 25.76 [23.24, 26.59] | 3237.55 [3178.07, 3340.50] |
| worktree-a77f / callback | 751.40 [735.26, 761.32] | 123.59 [111.98, 134.65] | 15.11 [14.84, 16.89] | 567.75 [532.78, 571.36] | 23.43 [21.72, 26.33] | 3258.11 [3225.18, 3268.83] |

| Version / mode | Incremental build cost | Incremental seal cost | Build / static |
|---|---:|---:|---:|
| v2-1-0 / callback | 396.11 ms | 392.68 ms | 2.146× |
| v2 / callback | 299.29 ms | 315.90 ms | 1.849× |
| worktree-a77f / callback | 401.30 ms | 404.01 ms | 2.146× |

Build timing: compiler.run invocation to callback, excluding setup/close, stats, bundle execution and artifact hashing. Seal covers seal → afterSeal and includes splitChunks, module/chunk IDs, code generation and other sealing work. It does not isolate splitChunks alone.

Validation counts name invocations and microtask turns, checks every callback resource and argument shape, exact loader-free module counts, shared-chunk membership, and the exported sum. Instrumentation is absent from measured callbacks. Outputs must match across naming modes and repetitions within each version. Loaded artifacts remain unchanged throughout the run.

Differences compare whole builds and describe this synthetic graph. Samples and ranges are descriptive rather than a significance test; background machine activity and OS caches are uncontrolled.

Raw configs, versions, environment and timings: raw/. Stats: stats/. Fixture hashes: fixture.json. Source/lock hashes: metadata.json. Source snapshot: source/. Outputs: output/. Logs: logs/.
