# splitChunks worker startup diagnostic

In-memory Node module-load hooks; no Rspack files or artifacts changed. Same artifact hashes as the September 11 archive. Main records worker creation/ready and build hooks; workers send one first-name timestamp each.

Three fresh-process runs per group, rotating order; existing 10,000-module fixture, development mode, no loaders/cache/incremental builds. All nine complete builds pass the original output and module checks. Worker-ready waits for all 31 ready messages before compiler.run; it does not perform a warmup compilation.

Median milliseconds:

| Group | make | seal | build | Ready wait | Compiler creation through build completion |
|---|---:|---:|---:|---:|---:|
| callback | 124.80 | 555.26 | 744.06 | 0.02 | 755.56 |
| worker-cold | 275.34 | 300.65 | 691.06 | 0.01 | 730.53 |
| worker-ready | 123.37 | 296.66 | 497.02 | 207.64 | 749.55 |

Workers are created during compiler construction. In cold sample 1, creation starts 13–36 ms after compiler construction begins, make starts at 77 ms, all ready messages arrive at 183–321 ms, seal starts at 367 ms, and first name executions occur at 402–408 ms. All observed first-name calls on all 31 workers are within seal in every completed worker run.

Waiting for readiness restores make to approximately the callback baseline in two of three runs (123.37, 228.95, 121.10 ms). This supports startup contention as a major cause of make inflation. It does not prove that every extra millisecond has the same cause. Waiting does not improve end-to-end cold-start time: include the excluded readiness wait when assessing total cost.

Source path: rspack.createCompiler → RspackOptionsApply.process → SplitChunksPlugin.apply/raw → getName → ensureNativeLoaderWorkers. Workers load worker.js and the binding, signal readiness, then asynchronously await the shared native queue. Name dispatch occurs from CompilationOptimizeChunks.

Raw results and timestamps are in each group directory. All source/native/worker artifact hashes match the September 11 archived worker sample. Preload hooks transform code only in memory.

Harness notes:

- Waiting for readiness is excluded from buildMs, included in compilerToBuildEndMs. This is a diagnostic comparison, not an end-to-end optimization.
- One early worker-ready harness attempt exited before build because workers were unreferenced; retained in worker-ready-incomplete-unref. The preload now keeps the process alive while awaiting readiness.
- An initial orchestration printing error stopped after callback-1 completed. Its result was retained; only unattempted complete-build jobs continued.
- Three descriptive samples per group. Worker-ready make samples include one slower sample (228.95 ms). No CPU profile was collected.

This archive preserves raw job/result paths from the original machine. Full stats and emitted bundles remain in the ignored root results directory. Run scripts expect that original workspace layout; adjust paths for a new checkout.
