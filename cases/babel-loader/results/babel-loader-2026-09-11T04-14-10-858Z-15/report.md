# babel-loader overhead benchmark

Development; all optimization flags disabled; no cache/incremental; serial loaders; no NormalModule loader hook taps. Serial fresh Node processes; rotating measurement order; OS cache retained.

Babel parses and prints the same JS module graph as the no-loader baseline. No presets, plugins, external Babel config, source maps, or Babel cache.

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
| v2, baseline | 297.55 [292.10, 334.93] | 109.67 [105.79, 125.69] | 15.44 [14.43, 16.61] | 123.37 [116.59, 141.56] | 24.14 [23.53, 26.92] | 1798.73 [1763.01, 1889.25] |
| worktree-0385, baseline | 327.73 [301.46, 343.86] | 131.71 [111.99, 152.80] | 15.38 [14.53, 15.98] | 122.71 [120.02, 125.57] | 25.79 [23.12, 31.90] | 1857.53 [1804.80, 1892.89] |
| v2, loader | 6609.23 [6350.22, 6754.84] | 6406.05 [6158.89, 6548.95] | 14.95 [14.76, 15.63] | 137.40 [123.61, 140.24] | 25.04 [24.43, 26.79] | 8247.21 [7933.61, 8380.62] |
| worktree-0385, loader | 6409.69 [6349.95, 6659.85] | 6212.75 [6136.51, 6448.37] | 16.15 [15.21, 16.89] | 135.94 [127.17, 139.88] | 28.00 [25.60, 28.11] | 8060.27 [7985.65, 8330.35] |

| Version | Loader overhead (loader − baseline) | Loader / baseline | Amortized overhead per module |
|---|---:|---:|---:|
| v2 | 6311.68 ms | 22.212× | 631.17 µs |
| worktree-0385 | 6081.96 ms | 19.558× | 608.20 µs |

Difference of loader overheads (worktree − 2.2.3): -229.72 ms.

- Baseline: worktree / 2.2.3 = 1.101×.
- Loader: worktree / 2.2.3 = 0.970×.

Build timing: compiler.run invocation to callback, excluding setup/close, stats, bundle execution and artifact hashing. make: make → finishMake; finishMake: finishMake → seal; seal: seal → afterSeal; emit: emit → afterEmit. Process includes all worker work.

Validation checks module counts, exact loader chains, compiler invocations, every resource, and emitted output. Instrumentation is absent from measured builds. Output hashes match across repetitions and versions for each pipeline; Less output also matches the CSS baseline. Core/native and loader dependency hashes remain unchanged between builds.

Overhead is the difference between median whole-build times. It includes compiler work, loader resolution, and Rust/JS scheduling; it does not isolate bridge overhead or prove a single source change caused a difference. Per-module figures amortize the total rather than time individual calls. Samples and ranges are descriptive, with uncontrolled machine activity.

Raw configs, dependency versions, environment and timings: raw/. Stats: stats/. Fixture hashes: fixture.json. Source/lock hashes: metadata.json. Exact source snapshot: source/. Outputs: output/. Logs: logs/.
