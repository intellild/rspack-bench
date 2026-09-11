# Noop JS loader overhead benchmark

Development; all optimization flags disabled; no cache/incremental; no loader versus one noop.cjs, parallel:false. No loader hook taps, React, CSS or builtin loaders. Serial fresh Node processes; rotating measurement order; OS cache retained.

10000 plain JS modules. Four groups: 2.2.3/worktree-0385 × no loader/one noop JS loader. One validation, one warmup and 5 measured builds per group.

Worktree: /data00/home/jinzhixin/.codex/worktrees/0385/rspack. HEAD: 0c244ef4114d0209bea0e40a684b6fd777609562. Status: clean. Loaded binary and core hashes identify the actual compiled artifacts.

No NormalModule loader hook is registered by this case. Only validation builds count noop calls; measured builds use the unmodified noop loader.

| Group | Package / compiled core | Noop calls |
|---|---|---:|
| v2, noop false | 2.2.3 / 2.2.3 | 0 |
| worktree-0385, noop false | 2.2.3 / 2.2.3 | 0 |
| v2, noop true | 2.2.3 / 2.2.3 | 10000 |
| worktree-0385, noop true | 2.2.3 / 2.2.3 | 10000 |

Times in milliseconds: median [min, max].

| Group | Build | make | finishMake | seal | emit | Process |
|---|---:|---:|---:|---:|---:|---:|
| v2, noop false | 295.22 [289.65, 317.49] | 107.01 [104.29, 123.94] | 14.58 [14.37, 15.08] | 121.11 [115.52, 125.06] | 27.09 [25.01, 31.09] | 1829.95 [1725.29, 1861.93] |
| worktree-0385, noop false | 324.57 [315.55, 329.00] | 127.40 [122.02, 131.74] | 15.09 [14.40, 16.32] | 125.29 [124.96, 132.31] | 26.50 [24.79, 26.74] | 1834.94 [1804.79, 1852.80] |
| v2, noop true | 1411.84 [1397.23, 1417.22] | 1217.49 [1205.70, 1225.43] | 15.40 [14.69, 15.56] | 126.49 [122.59, 135.58] | 23.46 [21.82, 29.65] | 2979.85 [2939.75, 3018.56] |
| worktree-0385, noop true | 1444.91 [1429.19, 1461.63] | 1250.33 [1233.93, 1265.76] | 15.76 [14.62, 16.31] | 129.49 [127.22, 132.63] | 23.32 [22.90, 24.93] | 3022.75 [2993.62, 3072.28] |

| Version | Loader overhead (noop − no loader) | Noop / no loader | Amortized overhead per module |
|---|---:|---:|---:|
| v2 | 1116.62 ms | 4.782× | 111.66 µs |
| worktree-0385 | 1120.34 ms | 4.452× | 112.03 µs |

Difference of loader overheads (worktree − 2.2.3): 3.72 ms.

- Noop false: worktree / 2.2.3 = 1.099×.
- Noop true: worktree / 2.2.3 = 1.023×.

Build timing: compiler.run invocation to callback, excluding setup/close, stats, bundle execution and artifact hashing. make: make → finishMake; finishMake: finishMake → seal; seal: seal → afterSeal; emit: emit → afterEmit. Process includes all worker work.

Verification checks every resource, the exact loader chain, zero/one noop calls per module, and the exported sum after executing each bundle. Outputs must be byte-identical within each version and pipeline across repetitions. Native/core paths and artifact hashes are saved for both versions and checked between builds.

Loader overhead is the difference between median whole-build times with and without noop. The per-module figure amortizes that difference; it is not a directly measured loader invocation duration. This includes loader resolution and Rust/JS scheduling, and does not isolate one internal function or source change. Samples and ranges are descriptive, with uncontrolled background machine activity.

Raw configs, environment, output hashes and timings: raw/. Stats: stats/. Fixture hashes: fixture.json. Source/lock hashes: metadata.json. Exact source snapshot: source/. Outputs: output/. Logs: logs/.
