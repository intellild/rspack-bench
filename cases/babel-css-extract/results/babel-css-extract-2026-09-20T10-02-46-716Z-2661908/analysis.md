# Interpretation and verification

All 28 builds passed: 4 diagnostic, 4 discarded warmup and 20 measured builds. Every build produced identical JS and CSS SHA-256 hashes across both versions and all repetitions. Each version contributed five measured cold/full-rebuild pairs. No failures, retries or outlier removal.

## Build phases

Medians in seconds; phase medians are not additive.

| State / phase | 2.2.6 | Branch | Change |
|---|---:|---:|---:|
| cold / buildMs | 99.875 | 101.946 | +2.07% |
| cold / makeMs | 76.020 | 77.982 | +2.58% |
| cold / finishMakeMs | 0.162 | 0.151 | -6.58% |
| cold / sealMs | 22.675 | 22.825 | +0.66% |
| cold / emitMs | 1.048 | 1.003 | -4.23% |
| warm / buildMs | 99.335 | 99.632 | +0.30% |
| warm / makeMs | 75.365 | 75.626 | +0.35% |
| warm / finishMakeMs | 0.161 | 0.155 | -3.54% |
| warm / sealMs | 21.373 | 23.147 | +8.30% |
| warm / emitMs | 1.235 | 1.120 | -9.36% |

## Branch loader overhead

The native task interval includes time waiting for worker capacity. That wait is queueing latency, not async-channel send/receive CPU cost. To keep it separate, the following table subtracts both queue wait and actual loader body on each task before computing quantiles. It still contains event-loop, RPC and other waits.

| State / loader | Task minus queue and body p50 / p95 | Main prepare interval p50 / p95 | Native context p50 / p95 | Native merge p50 / p95 |
|---|---:|---:|---:|---:|
| cold / loader | 1.804 / 35.038 | 0.596 / 1.793 | 0.015 / 0.021 | 0.014 / 0.020 |
| cold / css | 0.268 / 1.310 | 0.009 / 0.021 | 0.003 / 0.004 | 0.006 / 0.008 |
| cold / extract | 0.308 / 0.699 | 0.011 / 0.023 | 0.003 / 0.005 | 0.008 / 0.011 |
| warm / loader | 1.749 / 34.421 | 0.562 / 1.788 | 0.015 / 0.021 | 0.015 / 0.021 |
| warm / css | 0.270 / 1.330 | 0.011 / 0.018 | 0.003 / 0.004 | 0.006 / 0.009 |
| warm / extract | 0.299 / 0.531 | 0.015 / 0.027 | 0.004 / 0.006 | 0.008 / 0.012 |

Milliseconds. loader = worker Babel; css = main css-loader normal; extract = main extract pitch. The prepare column is TSFN entry to takeContext, including prepareWorkerTask RPC only for worker tasks. Main tasks perform local callback setup in that interval.

```text
crates/rspack_loader_runner/src/javascript.rs::loader_yield
  move boxed state → native task queue
       ↓
crates/rspack_binding_api/src/js_tasks/subscription.rs
  acquire worker capacity → receive → TSFN delivery
       ↓
packages/rspack/src/loader-runner/worker.ts
  await prepareWorkerTask (main RPC) → takeContext → runLoaders
       ↓
crates/rspack_binding_api/src/plugins/js_loader/worker.rs
  complete → merge → oneshot return → Rust context restoration
```

Babel body contains the Babel transform timer. Extract pitch contains importModule and the nested CSS build. Do not add these nested durations or subtract concurrent latency sums from whole-build wall time. Diagnostic instrumentation perturbs contention and is excluded from the performance medians. Baseline has no equivalent native timer; whole-version comparisons do not isolate queue dispatch.

## Validation

- Release binding built successfully; the same native artifact was used with diagnostics enabled and disabled. JS/core/native hashes stayed unchanged throughout the run.
- cargo check for rspack_js_tasks, rspack_loader_runner and rspack_binding_api passed.
- clippy for those crates with --all-targets passed with no warnings.
- Existing loader runner Rust tests: 10 passed. cargo fmt --all --check and git diff --check passed.
- Both versions passed a 24 JS + 24 CSS smoke run before the full comparison.
- Full source graph: 10,000 JS files (1,210–1,212 lines each), each with a dedicated CSS Module. 439 MiB total, 8 Babel workers, identical loader versions/options and caches disabled.
- All formal builds checked freshly built JS/CSS proxies, extracted CSS modules, exact loader chains, class names, all three rules per CSS file, and stable hashes. Diagnostic cold builds additionally evaluated the JS output and all generated functions/CSS class imports.
- Detailed timings: [report.md](report.md), [diagnostics.md](diagnostics.md). Per-task records and joins: [audit.tar.gz](audit.tar.gz). Raw samples: [raw/](raw/).
