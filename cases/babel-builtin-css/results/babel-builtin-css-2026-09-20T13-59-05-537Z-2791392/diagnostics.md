# Loader latency and overhead diagnostics

Instrumented validation builds only; excluded from performance samples. Cells show **p50 / p95 / max** in milliseconds. JSON includes count, mean and sum. These are elapsed task latencies, including waits; overlapping sums are not CPU time or build wall time.

Builtin CSS uses no JS loaders. CSS module lifecycle latency is measured separately; it is not loader dispatch overhead. Babel transform is nested inside Babel loader body.

## v2-2-6

| State / loader | Calls | Loader body | Babel transform | Babel adapter | Module residual | Native task total | Task residual |
|---|---:|---:|---:|---:|---:|---:|---:|
| cold / loader | 10000 | 42.742 / 99.650 / 1241.563 | 42.158 / 99.105 / 1240.936 | 0.499 / 0.629 / 66.861 | 11755.859 / 18943.289 / 20014.669 | — | — |
| warm / loader | 10000 | 42.874 / 99.912 / 382.749 | 42.332 / 99.306 / 382.260 | 0.498 / 0.587 / 88.842 | 16431.913 / 27327.372 / 27774.507 | — | — |

Builtin CSS module lifecycle cold: 0.535 / 1.849 / 39.474 ms; rebuild: 0.725 / 2.803 / 53.211 ms.

## worktree-bec7

| State / loader | Calls | Loader body | Babel transform | Babel adapter | Module residual | Native task total | Task residual |
|---|---:|---:|---:|---:|---:|---:|---:|
| cold / loader | 10000 | 38.553 / 106.870 / 415.401 | 37.778 / 105.926 / 376.144 | 0.738 / 1.014 / 59.390 | 12872.267 / 26624.909 / 27568.339 | 12912.866 / 26662.133 / 27677.342 | 12870.492 / 26623.004 / 27565.847 |
| warm / loader | 10000 | 40.374 / 108.157 / 189.100 | 39.629 / 107.362 / 188.167 | 0.732 / 0.931 / 34.866 | 17863.356 / 28556.079 / 29043.362 | 17900.234 / 28600.395 / 29125.200 | 17861.283 / 28553.662 / 29041.464 |

Builtin CSS module lifecycle cold: 0.203 / 0.301 / 31.284 ms; rebuild: 0.204 / 0.290 / 20.301 ms.


| State / loader | Dispatch prepare | Queue wait | Event-loop wait | Callback + main prepare | Native context prepare | JS residual | Native merge | Rust wake + restore |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cold / loader | 0.001 / 0.001 / 0.016 | 12860.397 / 26609.580 / 27555.528 | 0.024 / 29.335 / 81.798 | 0.431 / 1.241 / 211.752 | 0.014 / 0.019 / 0.104 | 0.404 / 0.571 / 106.653 | 0.015 / 0.022 / 0.045 | 0.046 / 0.073 / 0.309 |
| warm / loader | 0.001 / 0.002 / 0.018 | 17852.976 / 28544.567 / 29015.663 | 0.024 / 29.902 / 143.784 | 0.411 / 1.302 / 97.650 | 0.015 / 0.020 / 0.047 | 0.422 / 0.534 / 3.065 | 0.016 / 0.023 / 0.047 | 0.047 / 0.076 / 0.121 |

Other tasks (usually Babel pitch): 1; latency 101.681 / 101.681 / 101.681 ms.


Interpretation:

- loader = parallel Babel normal. Builtin CSS is verified to have no native JS task or JS proxy module. Every row joins two invocations per resource by cold/rebuild order, and verifies native phase, routing, task count and thread ID.
- Queue wait includes waiting for worker capacity; event-loop wait is receiver to TSFN callback entry.
- Callback + main prepare spans TSFN entry to takeContext. Workers await prepareWorkerTask RPC for the compiler/buildInfo bridge here; parallel loader hooks are skipped. Includes callback setup and locks, so this is not a pure RPC timer.
- Native context preparation is Rust construction only. Subsequent N-API conversion is part of JS interval.
- JS residual subtracts the actual loader body from context-ready to complete-entry. It includes loader-runner work, resolution/loading, RPC, N-API conversion and scheduling; not pure CPU overhead.
- Native merge starts after result conversion; Rust wake + restore includes oneshot scheduling and context restoration.
- Module residual uses buildModule to succeedModule minus body, also covering I/O, pitch, parsing, resolution and hook delivery.
- Diagnostic timers/hooks/file writes affect contention. Compare versions using the separate uninstrumented samples. Native residuals describe this branch; baseline has no equivalent native timer.
