# Import-time worker prewarming diagnostic

Existing 10,000-module splitChunks.name case; development mode, no loaders, caches or incremental builds. Three fresh-process runs per group. All six builds passed the existing module, chunk and output validation.

| Mode | make median | seal median | build median |
|---|---:|---:|---:|
| callback | 125.55 ms | 577.19 ms | 787.31 ms |
| worker | 123.89 ms | 313.24 ms | 530.19 ms |

All 31 worker constructors run before compiler creation. All 31 ready messages precede make in worker builds; each worker's first naming call remains inside seal. The preload observes lifecycle events but does not wait for readiness; the compiler implementation performs the wait.

The earlier same-day diagnostic, before this change, recorded worker make/build medians of 275.34/691.06 ms. These are small diagnostic samples, not a complete repeated benchmark matrix. The runner hashes artifacts between loading Rspack and constructing the compiler; prewarming can now overlap that work. Do not interpret the build-only change as an equal reduction in end-to-end process time.

See summary.json, artifacts.json, worktree.patch and the per-sample result.json/trace.json files. Native artifact hashes are unchanged. The worktree patch includes pre-existing splitChunks workerFunction changes; the benchmark did not modify native code.

This archive preserves raw job/result paths from the original machine. Full stats and emitted bundles remain in the ignored root results directory. Run scripts expect that original workspace layout; adjust paths for a new checkout.

Implementation: [web-infra-dev/rspack@b96dae3430](https://github.com/web-infra-dev/rspack/commit/b96dae3430811bf8587308b4186c817561510578). Committed after measurement; raw sample metadata is preserved.

Validation: JavaScript builds and targeted lint passed; 22 related compiler tests and the direct startup/readiness/error-exit fixtures passed. The full JavaScript test command was interrupted by CLI test failures, including a missing compiled/jiti/index.js dependency.
