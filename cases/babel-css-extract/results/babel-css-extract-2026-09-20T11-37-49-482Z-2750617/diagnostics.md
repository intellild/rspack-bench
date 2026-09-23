# Loader latency and overhead diagnostics

Instrumented validation builds only; excluded from performance samples. Cells show **p50 / p95 / max** in milliseconds. JSON includes count, mean and sum. These are elapsed task latencies, including waits; overlapping sums are not CPU time or build wall time.

CSS extract pitch awaits importModule and therefore includes the nested css-loader build. Never add extract and css-loader durations. Babel transform is nested inside Babel loader body.

## v2-2-6

| State / loader | Calls | Loader body | Babel transform | Babel adapter | Module residual | Native task total | Task residual |
|---|---:|---:|---:|---:|---:|---:|---:|
| cold / loader | 10000 | 42.515 / 100.450 / 396.518 | 41.969 / 99.762 / 357.698 | 0.486 / 0.613 / 81.465 | 10380.511 / 20344.148 / 20831.523 | — | — |
| warm / loader | 10000 | 42.275 / 97.477 / 390.674 | 41.722 / 97.015 / 390.174 | 0.486 / 0.592 / 44.962 | 15432.777 / 25055.695 / 26338.867 | — | — |
| cold / css | 10000 | 0.806 / 1.071 / 17.327 | — | — | 2.302 / 8.657 / 112.343 | — | — |
| warm / css | 10000 | 0.792 / 1.064 / 16.781 | — | — | 3.334 / 16.322 / 143.705 | — | — |
| cold / extract | 10000 | 9.331 / 32.886 / 195.395 | — | — | 1.207 / 3.374 / 131.601 | — | — |
| warm / extract | 10000 | 12.885 / 61.047 / 313.968 | — | — | 1.570 / 5.346 / 124.197 | — | — |
## worktree-bec7

| State / loader | Calls | Loader body | Babel transform | Babel adapter | Module residual | Native task total | Task residual |
|---|---:|---:|---:|---:|---:|---:|---:|
| cold / loader | 10000 | 42.017 / 111.701 / 311.359 | 40.668 / 110.384 / 301.851 | 0.911 / 3.447 / 41.393 | 15746.128 / 23806.373 / 24889.573 | 15792.396 / 23854.806 / 25048.657 | 15742.855 / 23804.495 / 24887.489 |
| warm / loader | 10000 | 41.350 / 110.426 / 190.607 | 40.005 / 108.850 / 189.801 | 0.848 / 2.995 / 81.698 | 18530.591 / 23808.439 / 24096.549 | 18581.884 / 23857.124 / 24192.904 | 18528.578 / 23806.279 / 24094.070 |
| cold / css | 10000 | 0.842 / 1.156 / 17.337 | — | — | 0.614 / 2.195 / 54.830 | 1.158 / 2.041 / 21.392 | 0.279 / 1.345 / 20.803 |
| warm / css | 10000 | 0.849 / 1.175 / 4.961 | — | — | 0.605 / 2.136 / 20.644 | 1.165 / 2.011 / 12.265 | 0.281 / 1.351 / 10.948 |
| cold / extract | 10000 | 4.288 / 8.491 / 80.748 | — | — | 0.526 / 1.399 / 18.779 | 4.677 / 9.057 / 83.066 | 0.327 / 0.754 / 18.453 |
| warm / extract | 10000 | 4.262 / 8.155 / 36.415 | — | — | 0.507 / 1.668 / 17.115 | 4.631 / 8.604 / 37.143 | 0.311 / 0.533 / 12.401 |

| State / loader | Dispatch prepare | Queue wait | Event-loop wait | Callback + main prepare | Native context prepare | JS residual | Native merge | Rust wake + restore |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cold / loader | 0.001 / 0.002 / 0.023 | 15733.343 / 23793.817 / 24868.325 | 0.027 / 31.138 / 76.507 | 0.599 / 1.745 / 266.154 | 0.015 / 0.020 / 0.098 | 0.663 / 1.458 / 155.298 | 0.014 / 0.021 / 0.056 | 0.037 / 0.069 / 0.346 |
| warm / loader | 0.001 / 0.002 / 0.138 | 18522.210 / 23796.144 / 24077.244 | 0.027 / 29.635 / 91.336 | 0.543 / 1.647 / 130.188 | 0.015 / 0.020 / 0.079 | 0.664 / 1.464 / 20.174 | 0.015 / 0.022 / 0.044 | 0.037 / 0.067 / 0.356 |
| cold / css | 0.001 / 0.003 / 0.018 | 0.003 / 0.005 / 0.019 | 0.017 / 1.107 / 20.519 | 0.009 / 0.022 / 0.102 | 0.003 / 0.004 / 0.022 | 0.190 / 0.251 / 3.680 | 0.006 / 0.008 / 0.033 | 0.033 / 0.050 / 1.116 |
| warm / css | 0.001 / 0.002 / 0.096 | 0.003 / 0.005 / 0.069 | 0.015 / 1.103 / 10.448 | 0.012 / 0.020 / 1.412 | 0.003 / 0.004 / 0.044 | 0.196 / 0.258 / 4.714 | 0.006 / 0.009 / 0.029 | 0.033 / 0.051 / 0.569 |
| cold / extract | 0.001 / 0.003 / 0.017 | 0.003 / 0.005 / 0.020 | 0.034 / 0.470 / 17.938 | 0.011 / 0.024 / 0.989 | 0.003 / 0.005 / 0.025 | 0.211 / 0.282 / 2.124 | 0.008 / 0.011 / 0.033 | 0.027 / 0.041 / 0.326 |
| warm / extract | 0.002 / 0.003 / 0.018 | 0.004 / 0.006 / 0.021 | 0.015 / 0.247 / 12.028 | 0.016 / 0.028 / 0.201 | 0.004 / 0.006 / 1.614 | 0.218 / 0.293 / 4.980 | 0.008 / 0.012 / 0.034 | 0.027 / 0.042 / 1.677 |

Other tasks (usually Babel pitch): 2; latency 53.404 / 96.964 / 96.964 ms.


Interpretation:

- loader = parallel Babel normal; css = main css-loader normal; extract = main CSS extract pitch (including nested importModule). Every row joins two invocations per resource by cold/rebuild order, and verifies native phase, routing, task count and thread ID.
- Queue wait includes waiting for worker capacity; event-loop wait is receiver to TSFN callback entry.
- Callback + main prepare spans TSFN entry to takeContext. Workers await prepareWorkerTask RPC here; main runs loader hook/context preparation. Includes callback setup and locks, so this is not a pure RPC timer.
- Native context preparation is Rust construction only. Subsequent N-API conversion is part of JS interval.
- JS residual subtracts the actual loader body from context-ready to complete-entry. It includes loader-runner work, resolution/loading, RPC, N-API conversion and scheduling; not pure CPU overhead.
- Native merge starts after result conversion; Rust wake + restore includes oneshot scheduling and context restoration.
- Module residual uses buildModule to succeedModule minus body, also covering I/O, pitch, parsing, resolution and hook delivery. Outer CSS module timing and extract body include the nested module build.
- Diagnostic timers/hooks/file writes affect contention. Compare versions using the separate uninstrumented samples. Native residuals describe this branch; baseline has no equivalent native timer.
