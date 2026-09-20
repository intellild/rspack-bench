# Mixed-loader dispatch analysis

Local a77f, 10,000 existing modules, three synchronous noop JS loaders, all caches disabled. One cold/full-rebuild pair per mode. All six instrumented builds passed the original module/output checks and loaded the same physical artifacts as the performance run. Counts use shared atomic counters; instrumented times are excluded from benchmark distributions.

| Full rebuild count | All main | Mixed | All parallel |
|---|---:|---:|---:|
| Main normal runner | 10,000 | 20,000 | 0 |
| Main hooks-only runner | 0 | 10,000 | 10,000 |
| Worker normal runner | 0 | 10,000 | 10,000 |
| Total runner entries | 10,000 | 40,000 | 20,000 |
| Worker-to-main options requests | 0 | 30,000 | 30,000 |
| Remote function / additionalData calls | 0 / 0 | 0 / 0 | 0 / 0 |

The all-main normal loop executes right, middle and left without yielding. Mixed mode breaks at each parallel-flag boundary: main executes right, Rust calls main again for hooks only, Rust dispatches middle to a worker, then Rust calls main for left. Each runner entry reconstructs its loader context and all three LoaderObject instances. Main/worker transitions also convert content and loader/dependency state between native and JavaScript representations. Hooks-only execution constructs the full context and snapshots its properties, even without user loader-hook taps.

The worker eagerly materializes all three loader options, including options for the two main-thread loaders. Three distinct option handles each cause one synchronous main-thread request per module. Each response includes compiler data and filesystem/function proxies as well as options. The per-task bridge map is cleared after completion, so the next module repeats the requests. Full rebuilds show exactly 30,000 requests; cold builds show 30,003 including one worker pitch-discovery task. No loader file has a pitch function, and warm builds issue no pitch tasks.

This explains why prewarming cannot remove the mixed chain's steady-state overhead: it remains one serial dependency chain per module, and the middle noop has no useful computation to offset extra scheduling. All-parallel has the same options-request count but half as many runner entries as mixed, helping distinguish bridge-fetch cost from splitting the chain. Counts do not quantify each component's share of the time difference.

Relevant implementation: packages/rspack/src/loader-runner/index.ts (normal-loop parallel boundary, LoaderObject options, full context construction), crates/rspack_binding_api/src/plugins/js_loader/scheduler.rs (main hooks before worker dispatch), packages/rspack/src/loader-runner/service.ts (bridge retrieval), and worker.ts (per-task bridge clearing).

Potential optimizations: avoid the main hooks-only pass when provably unused; reuse immutable compiler/loader descriptors with explicit lifecycle/invalidation; materialize inactive loader metadata lazily while preserving loader-context API compatibility; avoid copying source content for a hooks-only task. Mixed execution still has necessary thread boundaries when the transforms depend on one another.

See summary.json and the per-mode counts.json/result.json files for raw evidence. The source/native artifacts were not modified; the preload injects counters only in memory. An initial counter attempted to interpret loader states as numbers and was corrected to the actual string enum before these successful runs. Those harness-failure records remain in the ignored original directory. Original performance samples and their weak-reference failures remain unchanged.
