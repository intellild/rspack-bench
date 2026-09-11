# less-loader overhead benchmark

Development; all optimization flags disabled; no cache/incremental; serial loaders; no NormalModule loader hook taps. Serial fresh Node processes; rotating measurement order; OS cache retained.

10,000 Less/CSS workload modules by default, plus one JS entry importing every stylesheet. Less variables, mixins, nesting and arithmetic compile through less-loader to native CSS; baseline uses equivalent CSS precompiled outside build timers.

10000 workload modules. Four groups: 2.2.3/worktree-0385 × baseline/loader. One validation, one warmup and 5 measured builds per group.

Worktree: /data00/home/jinzhixin/.codex/worktrees/0385/rspack. HEAD: 0c244ef4114d0209bea0e40a684b6fd777609562. Status: clean. Actual compiled artifacts are identified by hashes in raw/.

| Group | Package / compiled core | Loader calls | Compiler calls |
|---|---|---:|---:|
| v2, baseline | 2.2.3 / 2.2.3 | 0 | 0 |
| worktree-0385, baseline | 2.2.3 / 2.2.3 | 0 | 0 |
| v2, loader | 2.2.3 / 2.2.3 | 10000 | 10000 |
| worktree-0385, loader | 2.2.3 / 2.2.3 | 10000 | 10000 |

Times in milliseconds: median [min, max].

| Group | Build | make | finishMake | seal | emit | Process |
|---|---:|---:|---:|---:|---:|---:|
| v2, baseline | 303.60 [296.87, 316.68] | 92.95 [90.55, 97.87] | 13.28 [13.25, 13.74] | 166.71 [159.52, 170.98] | 5.78 [5.47, 7.05] | 1162.01 [1133.58, 1188.31] |
| worktree-0385, baseline | 320.92 [311.14, 324.68] | 97.90 [96.18, 100.63] | 13.43 [13.30, 14.98] | 172.96 [166.08, 176.66] | 7.07 [6.42, 7.92] | 1213.65 [1192.24, 1231.42] |
| v2, loader | 6277.60 [5895.95, 6292.80] | 6056.22 [5680.85, 6075.30] | 14.47 [14.24, 15.26] | 170.33 [165.63, 176.05] | 5.38 [4.52, 7.08] | 7508.94 [7146.17, 7550.31] |
| worktree-0385, loader | 6200.20 [6052.27, 6375.47] | 5967.86 [5833.10, 6151.83] | 14.09 [13.52, 15.21] | 180.72 [171.32, 188.31] | 5.71 [5.59, 7.35] | 7415.79 [7272.01, 7593.82] |

| Version | Loader overhead (loader − baseline) | Loader / baseline | Amortized overhead per module |
|---|---:|---:|---:|
| v2 | 5974.00 ms | 20.677× | 597.40 µs |
| worktree-0385 | 5879.27 ms | 19.320× | 587.93 µs |

Difference of loader overheads (worktree − 2.2.3): -94.72 ms.

- Baseline: worktree / 2.2.3 = 1.057×.
- Loader: worktree / 2.2.3 = 0.988×.

Build timing: compiler.run invocation to callback, excluding setup/close, stats, bundle execution and artifact hashing. make: make → finishMake; finishMake: finishMake → seal; seal: seal → afterSeal; emit: emit → afterEmit. Process includes all worker work.

Validation checks module counts, exact loader chains, compiler invocations, every resource, and emitted output. Instrumentation is absent from measured builds. Output hashes match across repetitions and versions for each pipeline; Less output also matches the CSS baseline. Core/native and loader dependency hashes remain unchanged between builds.

Overhead is the difference between median whole-build times. It includes compiler work, loader resolution, and Rust/JS scheduling; it does not isolate bridge overhead or prove a single source change caused a difference. Per-module figures amortize the total rather than time individual calls. Samples and ranges are descriptive, with uncontrolled machine activity.

Raw configs, dependency versions, environment and timings: raw/. Stats: stats/. Fixture hashes: fixture.json. Source/lock hashes: metadata.json. Exact source snapshot: source/. Outputs: output/. Logs: logs/.
