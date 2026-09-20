# Loader latency and overhead diagnostics

Instrumented validation builds only; excluded from performance samples. Cells show **p50 / p95 / max** in milliseconds. JSON includes count, mean and sum. These are elapsed task latencies, including waits; overlapping sums are not CPU time or build wall time.

CSS extract pitch awaits importModule and therefore includes the nested css-loader build. Never add extract and css-loader durations. Babel transform is nested inside Babel loader body.

## v2-2-6

| State / loader | Calls | Loader body | Babel transform | Babel adapter | Module residual | Native task total | Task residual |
|---|---:|---:|---:|---:|---:|---:|---:|
| cold / loader | 10000 | 41.309 / 96.391 / 429.172 | 40.783 / 95.548 / 396.431 | 0.488 / 0.616 / 62.681 | 9426.310 / 14333.156 / 15439.067 | — | — |
| warm / loader | 10000 | 42.493 / 107.545 / 1890.784 | 41.935 / 106.954 / 1890.252 | 0.487 / 0.606 / 31.038 | 15008.338 / 23952.765 / 24795.456 | — | — |
| cold / css | 10000 | 0.771 / 1.058 / 17.670 | — | — | 1.750 / 4.820 / 54.336 | — | — |
| warm / css | 10000 | 0.752 / 1.119 / 21.561 | — | — | 2.788 / 15.753 / 407.759 | — | — |
| cold / extract | 10000 | 7.545 / 17.152 / 79.243 | — | — | 1.039 / 2.444 / 46.846 | — | — |
| warm / extract | 10000 | 10.742 / 55.489 / 484.209 | — | — | 1.419 / 4.045 / 264.381 | — | — |
## worktree-bec7

| State / loader | Calls | Loader body | Babel transform | Babel adapter | Module residual | Native task total | Task residual |
|---|---:|---:|---:|---:|---:|---:|---:|
| cold / loader | 10000 | 42.113 / 110.303 / 1847.359 | 40.662 / 108.426 / 1846.324 | 0.895 / 3.489 / 62.540 | 16851.591 / 23028.301 / 23910.996 | 16911.398 / 23073.732 / 23958.602 | 16849.254 / 23026.088 / 23909.276 |
| warm / loader | 10000 | 42.161 / 111.240 / 260.672 | 40.935 / 109.492 / 259.209 | 0.822 / 2.931 / 22.592 | 16137.427 / 28965.052 / 29996.035 | 16185.549 / 29025.988 / 30081.243 | 16135.297 / 28962.322 / 29993.938 |
| cold / css | 10000 | 0.833 / 1.175 / 18.526 | — | — | 0.601 / 2.198 / 63.797 | 1.138 / 2.031 / 22.939 | 0.271 / 1.313 / 18.996 |
| warm / css | 10000 | 0.835 / 1.139 / 7.959 | — | — | 0.588 / 2.031 / 27.043 | 1.143 / 2.016 / 17.428 | 0.273 / 1.333 / 16.414 |
| cold / extract | 10000 | 4.239 / 8.380 / 91.020 | — | — | 0.508 / 1.303 / 20.250 | 4.610 / 8.981 / 93.538 | 0.311 / 0.702 / 17.371 |
| warm / extract | 10000 | 4.099 / 8.058 / 33.427 | — | — | 0.491 / 1.608 / 18.382 | 4.451 / 8.556 / 33.733 | 0.302 / 0.534 / 16.591 |

| State / loader | Dispatch prepare | Queue wait | Event-loop wait | Callback + main prepare | Native context prepare | JS residual | Native merge | Rust wake + restore |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cold / loader | 0.001 / 0.002 / 0.021 | 16837.207 / 23010.255 / 23878.438 | 0.029 / 31.875 / 72.935 | 0.596 / 1.793 / 1684.310 | 0.015 / 0.021 / 0.163 | 0.666 / 1.482 / 564.889 | 0.014 / 0.020 / 0.053 | 0.037 / 0.067 / 0.428 |
| warm / loader | 0.001 / 0.002 / 0.034 | 16123.887 / 28959.163 / 29980.521 | 0.028 / 31.250 / 66.632 | 0.562 / 1.788 / 139.771 | 0.015 / 0.021 / 0.071 | 0.665 / 1.464 / 23.313 | 0.015 / 0.021 / 0.047 | 0.038 / 0.067 / 0.381 |
| cold / css | 0.001 / 0.002 / 0.014 | 0.003 / 0.005 / 0.021 | 0.017 / 1.070 / 18.503 | 0.009 / 0.021 / 0.140 | 0.003 / 0.004 / 0.029 | 0.183 / 0.249 / 5.332 | 0.006 / 0.008 / 0.038 | 0.033 / 0.050 / 0.808 |
| warm / css | 0.001 / 0.002 / 0.018 | 0.002 / 0.005 / 0.020 | 0.015 / 1.090 / 15.937 | 0.011 / 0.018 / 0.192 | 0.003 / 0.004 / 0.023 | 0.190 / 0.256 / 0.722 | 0.006 / 0.009 / 0.035 | 0.033 / 0.049 / 0.227 |
| cold / extract | 0.001 / 0.002 / 0.108 | 0.003 / 0.005 / 0.093 | 0.034 / 0.428 / 16.936 | 0.011 / 0.023 / 0.113 | 0.003 / 0.005 / 0.023 | 0.198 / 0.270 / 5.428 | 0.008 / 0.011 / 0.051 | 0.027 / 0.040 / 1.108 |
| warm / extract | 0.001 / 0.003 / 0.073 | 0.003 / 0.006 / 0.030 | 0.016 / 0.247 / 16.153 | 0.015 / 0.027 / 0.100 | 0.004 / 0.006 / 0.144 | 0.213 / 0.288 / 0.789 | 0.008 / 0.012 / 0.049 | 0.027 / 0.042 / 0.368 |

Other tasks (usually Babel pitch): 2; latency 62.321 / 98.356 / 98.356 ms.


Interpretation:

- loader = parallel Babel normal; css = main css-loader normal; extract = main CSS extract pitch (including nested importModule). Every row joins two invocations per resource by cold/rebuild order, and verifies native phase, routing, task count and thread ID.
- Queue wait includes waiting for worker capacity; event-loop wait is receiver to TSFN callback entry.
- Callback + main prepare spans TSFN entry to takeContext. Workers await prepareWorkerTask RPC here; main runs loader hook/context preparation. Includes callback setup and locks, so this is not a pure RPC timer.
- Native context preparation is Rust construction only. Subsequent N-API conversion is part of JS interval.
- JS residual subtracts the actual loader body from context-ready to complete-entry. It includes loader-runner work, resolution/loading, RPC, N-API conversion and scheduling; not pure CPU overhead.
- Native merge starts after result conversion; Rust wake + restore includes oneshot scheduling and context restoration.
- Module residual uses buildModule to succeedModule minus body, also covering I/O, pitch, parsing, resolution and hook delivery. Outer CSS module timing and extract body include the nested module build.
- Diagnostic timers/hooks/file writes affect contention. Compare versions using the separate uninstrumented samples. Native residuals describe this branch; baseline has no equivalent native timer.
