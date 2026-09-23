# Interpretation and verification

All 28 builds passed: 4 diagnostic, 4 discarded warmup and 20 measured builds. Every build produced identical JS and CSS SHA-256 hashes across both versions and all repetitions. Each version contributed five measured cold/full-rebuild pairs. No failures, retries or outlier removal.

## Build phases

Medians in seconds; phase medians are not additive.

| State / phase | 2.2.6 | Branch | Change |
|---|---:|---:|---:|
| cold / buildMs | 97.218 | 103.704 | +6.67% |
| cold / makeMs | 75.478 | 78.982 | +4.64% |
| cold / finishMakeMs | 0.158 | 0.156 | -1.06% |
| cold / sealMs | 20.108 | 22.989 | +14.33% |
| cold / emitMs | 0.982 | 0.982 | +0.03% |
| warm / buildMs | 98.310 | 100.826 | +2.56% |
| warm / makeMs | 75.392 | 76.938 | +2.05% |
| warm / finishMakeMs | 0.171 | 0.153 | -10.49% |
| warm / sealMs | 20.804 | 22.374 | +7.55% |
| warm / emitMs | 1.229 | 1.211 | -1.44% |

## Branch loader overhead

The native task interval includes time waiting for worker capacity. That wait is queueing latency, not async-channel send/receive CPU cost. To keep it separate, the following table subtracts both queue wait and actual loader body on each task before computing quantiles. It still contains event-loop, RPC and other waits.

| State / loader | Task minus queue and body p50 / p95 | Main prepare interval p50 / p95 | Native context p50 / p95 | Native merge p50 / p95 |
|---|---:|---:|---:|---:|
| cold / loader | 1.730 / 34.372 | 0.599 / 1.745 | 0.015 / 0.020 | 0.014 / 0.021 |
| cold / css | 0.277 / 1.343 | 0.009 / 0.022 | 0.003 / 0.004 | 0.006 / 0.008 |
| cold / extract | 0.324 / 0.751 | 0.011 / 0.024 | 0.003 / 0.005 | 0.008 / 0.011 |
| warm / loader | 1.707 / 32.580 | 0.543 / 1.647 | 0.015 / 0.020 | 0.015 / 0.022 |
| warm / css | 0.278 / 1.348 | 0.012 / 0.020 | 0.003 / 0.004 | 0.006 / 0.009 |
| warm / extract | 0.307 / 0.530 | 0.016 / 0.028 | 0.004 / 0.006 | 0.008 / 0.012 |

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
- cargo check -p rspack_binding_api --offline passed.
- cargo clippy -p rspack_binding_api --all-targets --offline -- -D warnings passed.
- All 74 focused parallel loader integration tests passed using the development binding with test-loader enabled; see branch-tests.log. cargo fmt --all --check, JS lint and git diff --check passed.
- Both versions passed a 24 JS + 24 CSS smoke run before the full comparison.
- Full source graph: 10,000 JS files (1,210–1,212 lines each), each with a dedicated CSS Module. 439 MiB total, 8 Babel workers, identical loader versions/options and caches disabled.
- All formal builds checked freshly built JS/CSS proxies, extracted CSS modules, exact loader chains, class names, all three rules per CSS file, and stable hashes. Diagnostic cold builds additionally evaluated the JS output and all generated functions/CSS class imports.
- Detailed timings: [report.md](report.md), [diagnostics.md](diagnostics.md). Per-task records and joins: [audit.tar.gz](audit.tar.gz). Raw samples: [raw/](raw/).
