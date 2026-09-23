# Parallel Babel + builtin CSS benchmark

Development bundler configuration with release native artifacts. Optimizations, incremental, Rspack caches, loader cache and Babel disk/config caches disabled. Every large JS module runs parallel Babel parse/print and imports one CSS Module, processed by builtin CSS (css/module), without css-loader or CSS extract plugin. Identical explicit worker counts.

Each fresh process creates one compiler: cold build, then full rebuild with all resources marked modified. Serial processes; rotating group order; OS cache retained. Validation and warmup pairs excluded from samples.

10000 JS modules + 10000 CSS Modules; 1210-1212 lines per JS module; 439.00 MiB input; 8 workers; one CSS Module per JS module; native CSS parsing and generation. One validation and one warmup pair, then 5 measured pairs per group.

Worktree HEAD: b4222b41b713ca4e99d886d213c95e4cc7302a90; status: M crates/node_binding/napi-binding.d.ts
 M crates/node_binding/rspack.wasi-browser.js
 M crates/rspack_binding_api/src/plugins/js_loader/bridge.rs
 M crates/rspack_binding_api/src/plugins/js_loader/context.rs
 M crates/rspack_binding_api/src/plugins/js_loader/result.rs
 M packages/rspack/src/browser/service.ts
 M packages/rspack/src/config/types.ts
 M packages/rspack/src/loader-runner/index.ts
 M packages/rspack/src/loader-runner/service.ts
 M packages/rspack/src/loader-runner/worker.ts
 M tests/rspack-test/configCases/loader-parallel/function-options/index.js
 M tests/rspack-test/configCases/loader-parallel/function-options/loader.js
 M tests/rspack-test/configCases/loader-parallel/function-options/main-loader.js
 M tests/rspack-test/configCases/loader-parallel/native-module/loader.js
 M tests/rspack-test/configCases/loader-parallel/native-module/rspack.config.mjs
 M website/docs/en/config/module-rules.mdx
 M website/docs/zh/config/module-rules.mdx
?? tests/rspack-test/configCases/loader-parallel/serialized-data/
?? tests/rspack-test/configCases/loader-parallel/skip-loader-hook/.

Milliseconds: median [min, max]. Full rebuild forces all JS and CSS resources through module building again.

| Version | parallel | Setup + cold build | Cold build | Full rebuild | Cold make | Rebuild make | Samples |
|---|---|---:|---:|---:|---:|---:|---:|
| v2-2-6 | on | 73662.20 [73190.55, 75798.83] | 73651.68 [73180.23, 75787.66] | 74538.40 [73133.81, 75029.29] | 72387.14 [71842.66, 74485.52] | 73109.29 [71706.84, 73546.99] | 5/5 |
| worktree-bec7 | on | 74456.28 [72957.03, 78523.58] | 74445.64 [72946.43, 78512.53] | 74253.64 [72079.56, 74755.78] | 73040.54 [71587.91, 77182.05] | 72871.26 [70652.39, 73390.14] | 5/5 |

| Mode | Branch vs 2.2.6: setup + cold | Branch vs 2.2.6: full rebuild |
|---|---:|---:|
| parallel | 1.08% | -0.38% |

Environment: Node v24.20.0; linux/x64; Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz; 32 logical CPUs (32 available). Negative percentages mean less time.


Failed pairs: 0; no automatic retries.

| Group | Cold / rebuild Babel calls / builtin CSS modules | Execution thread IDs |
|---|---:|---|
| v2-2-6-parallel-on | 10000 Babel + 10000 builtin CSS modules / 10000 Babel + 10000 builtin CSS modules | 1, 2, 3, 4, 5, 6, 7, 8 |
| worktree-bec7-parallel-on | 10000 Babel + 10000 builtin CSS modules / 10000 Babel + 10000 builtin CSS modules | 1, 2, 3, 4, 5, 6, 7, 8 |

Timing: compiler.run invocation through callback; excludes setup/close, stats, audits, bundle evaluation and hashing. setupAndColdBuildMs includes compiler setup because worker boot can start there. Process includes the entire two-build child lifetime and validation overhead.

Validation instruments Babel loader/transform in workers and audits builtin CSS module lifecycles. CSS has no JS loader or extraction proxy. Measured runs contain no audit preload. Every build checks freshly built modules, exact loader chain, resource set and a streaming output hash. Only cold validation builds evaluate the bundle in a separate Node process with a 24 GiB heap limit; exported value and checksum evaluate all generated functions. All later outputs must match the validated hash. Output hashes must match within each version across repetitions. Rspack artifact and Babel dependency hashes must remain unchanged.

This generated workload combines parallel Babel parse/print with builtin CSS parsing and generation without nested importModule builds. Diagnostics use per-loader timers and branch native task timings, and are excluded from performance samples. The overhead report distinguishes queue/event-loop waiting from context preparation and merge; concurrent latency sums are not build wall time or CPU time. Whole-build comparisons include changes between versions beyond queue dispatch. Ranges are descriptive; machine activity and OS caches are not controlled. Raw records include setup/process timings and environment.

Sources/lockfile: source/. Native/core hashes, timings, configuration: raw/. Validation thread audits: audit/. Full stats: stats/. Source file hashes: fixture.json. Local source changes: worktree.patch.
