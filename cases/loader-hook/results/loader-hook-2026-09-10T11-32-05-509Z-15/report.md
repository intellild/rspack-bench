# NormalModule loader hook benchmark

Development; all optimization flags disabled; no cache/incremental; only noop.cjs, parallel:false. No React, CSS or builtin loaders. Serial fresh Node processes; rotating measurement order; OS cache retained.

10000 plain JS modules, each running exactly one noop JS loader. Four groups: 2.2.3/local × hook absent/empty tap. One validation, one warmup and 5 measured builds per group.

The tap is registered using compiler.hooks.compilation → NormalModule.getCompilationHooks(compilation).loader.tap. The no-hook group does not register or retrieve this hook in benchmark code. Measured taps are empty; validation alone counts hook and noop calls.

| Group | Package / compiled core | Noop calls | Hook calls |
|---|---|---:|---:|
| v2, hook false | 2.2.3 / 2.2.3 | 10000 | 0 |
| local, hook false | 2.2.3 / 2.2.3 | 10000 | 0 |
| v2, hook true | 2.2.3 / 2.2.3 | 10000 | 10001 |
| local, hook true | 2.2.3 / 2.2.3 | 10000 | 10000 |

Times in milliseconds: median [min, max].

| Group | Build | make | finishMake | seal | emit | Process |
|---|---:|---:|---:|---:|---:|---:|
| v2, hook false | 1417.86 [1387.18, 1501.82] | 1214.77 [1181.35, 1304.12] | 15.49 [14.22, 17.70] | 132.05 [125.05, 137.00] | 26.81 [26.00, 27.39] | 2980.33 [2918.68, 3132.83] |
| local, hook false | 1454.07 [1396.81, 1479.62] | 1247.88 [1205.97, 1264.25] | 16.92 [15.34, 17.08] | 131.29 [121.89, 142.00] | 28.38 [25.79, 29.72] | 3078.22 [3040.89, 3188.71] |
| v2, hook true | 1443.31 [1393.92, 1512.08] | 1241.17 [1195.60, 1312.79] | 15.28 [14.72, 15.87] | 129.80 [121.92, 136.10] | 25.70 [24.35, 28.48] | 3026.14 [2937.31, 3094.79] |
| local, hook true | 1831.63 [1817.90, 1931.55] | 1622.21 [1607.01, 1718.92] | 17.49 [17.14, 18.62] | 133.12 [128.11, 134.79] | 31.15 [30.28, 32.62] | 3552.06 [3477.19, 3672.40] |

| Version | Hook build overhead (on − off) | On / off |
|---|---:|---:|
| v2 | 25.45 ms | 1.018× |
| local | 377.55 ms | 1.260× |

Difference of hook overheads (local − 2.2.3): 352.10 ms.

- Hook false: local / 2.2.3 = 1.026×.
- Hook true: local / 2.2.3 = 1.269×.

Build timing: compiler.run invocation to callback, excluding setup/close, stats, bundle execution and artifact hashing. make: make → finishMake; finishMake: finishMake → seal; seal: seal → afterSeal; emit: emit → afterEmit. Process includes all worker work.

Verification checks every noop/hook resource, exact loader chains in stats, and the exported sum after executing the bundle. Outputs must be byte-identical within each version with/without the tap and across repetitions. Native/core paths and artifact hashes are saved for both versions and checked between builds.

These are whole-build comparisons of two different builds. The within-version on/off comparison estimates tap registration overhead; the difference of overheads is not proof that only one source change is responsible. Samples and ranges are descriptive, with uncontrolled background machine activity.

Raw configs, environment, output hashes and timings: raw/. Stats: stats/. Fixture hashes: fixture.json. Source/lock hashes: metadata.json. Outputs: output/. Logs: logs/.
