# Interpretation and verification

All 28 builds passed: 4 diagnostic, 4 discarded warmup and 20 measured builds. Every build produced identical JS and CSS SHA-256 hashes across both versions and all repetitions. Each version contributed five measured cold/full-rebuild pairs. No failures, retries or outlier removal.

## Build phases

Medians in seconds; phase medians are not additive.

| State / phase | 2.2.6 | Branch | Change |
|---|---:|---:|---:|
| cold / buildMs | 73.652 | 74.446 | +1.08% |
| cold / makeMs | 72.387 | 73.041 | +0.90% |
| cold / finishMakeMs | 0.039 | 0.031 | -18.83% |
| cold / sealMs | 0.352 | 0.335 | -4.93% |
| cold / emitMs | 0.913 | 0.936 | +2.57% |
| warm / buildMs | 74.538 | 74.254 | -0.38% |
| warm / makeMs | 73.109 | 72.871 | -0.33% |
| warm / finishMakeMs | 0.032 | 0.025 | -22.02% |
| warm / sealMs | 0.341 | 0.329 | -3.43% |
| warm / emitMs | 1.044 | 1.024 | -1.94% |

## Branch loader overhead

The native task interval includes time waiting for worker capacity. That wait is queueing latency, not async-channel send/receive CPU cost. To keep it separate, the following table subtracts both queue wait and actual loader body on each task before computing quantiles. It still contains event-loop, RPC and other waits.

| State / loader | Task minus queue and body p50 / p95 | Main prepare interval p50 / p95 | Native context p50 / p95 | Native merge p50 / p95 |
|---|---:|---:|---:|---:|
| cold / loader | 0.995 / 31.558 | 0.431 / 1.241 | 0.014 / 0.019 | 0.015 / 0.022 |
| warm / loader | 0.993 / 31.882 | 0.411 / 1.302 | 0.015 / 0.020 | 0.016 / 0.023 |

Milliseconds. loader = worker Babel. Builtin CSS dispatches no JS task; its native module lifecycle latency is recorded separately in diagnostics.md. The prepare column is TSFN entry to takeContext, including prepareWorkerTask RPC only for worker tasks. Worker preparation skips loader hooks and returns bridge data in the same response; compare total outside-queue/body latency because the earlier run fetched that data later inside the JS interval.

```text
crates/rspack_loader_runner/src/javascript.rs::loader_yield
  move boxed state → native task queue
       ↓
crates/rspack_binding_api/src/js_tasks/subscription.rs
  acquire worker capacity → receive → TSFN delivery
       ↓
packages/rspack/src/loader-runner/worker.ts
  await prepareWorkerTask (main bridge only; no loader hook) → takeContext → runLoaders
       ↓
crates/rspack_binding_api/src/plugins/js_loader/worker.rs
  complete → merge → oneshot return → Rust context restoration
```

Babel body contains the Babel transform timer. Do not add these nested durations or subtract concurrent latency sums from whole-build wall time. Diagnostic instrumentation perturbs contention and is excluded from the performance medians. Baseline has no equivalent native timer; whole-version comparisons do not isolate queue dispatch.

## Validation

- Release binding built successfully; the same native artifact was reused from the V8 experiment, with diagnostics enabled and disabled. JS/core/native hashes stayed unchanged throughout the run.
- The unchanged native binary reuses the successful cargo check and clippy validation from the preceding V8 experiment.
- All 76 focused parallel loader integration tests passed using the development binding with test-loader enabled; see branch-tests.log. cargo fmt --all --check, JS lint and git diff --check passed.
- Both versions passed a 24 JS + 24 CSS smoke run before the full comparison.
- Full source graph: 10,000 JS files (1,210–1,212 lines each), each with a dedicated CSS Module. 439 MiB total, 8 Babel workers, identical loader versions/options and caches disabled.
- All formal builds checked freshly built JS and builtin CSS modules, zero CSS proxies, Babel loader chains and empty CSS loader chains, class names, all three rules per CSS file, and stable hashes. Diagnostic cold builds additionally evaluated the JS output and all generated functions/CSS class imports.
- Detailed timings: [report.md](report.md), [diagnostics.md](diagnostics.md). Per-task records and joins: [audit.tar.gz](audit.tar.gz). Raw samples: [raw/](raw/).
