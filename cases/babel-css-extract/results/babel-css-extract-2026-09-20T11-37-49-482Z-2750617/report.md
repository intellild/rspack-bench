# Parallel Babel + main-thread CSS extraction benchmark

Development bundler configuration with release native artifacts. Optimizations, incremental, Rspack caches, loader cache and Babel disk/config caches disabled. Every large JS module runs parallel Babel parse/print and imports one CSS Module, processed on main by css-loader and CssExtractRspackPlugin. Identical explicit worker counts.

Each fresh process creates one compiler: cold build, then full rebuild with all resources marked modified. Serial processes; rotating group order; OS cache retained. Validation and warmup pairs excluded from samples.

10000 JS modules + 10000 CSS Modules; 1210-1212 lines per JS module; 439.00 MiB input; 8 workers; one CSS Module per JS module; CSS extraction on main. One validation and one warmup pair, then 5 measured pairs per group.

Worktree HEAD: b4222b41b713ca4e99d886d213c95e4cc7302a90; status: M crates/node_binding/napi-binding.d.ts
 M crates/node_binding/rspack.wasi-browser.js
 M crates/rspack_binding_api/src/plugins/js_loader/bridge.rs
 M crates/rspack_binding_api/src/plugins/js_loader/context.rs
 M crates/rspack_binding_api/src/plugins/js_loader/result.rs
 M packages/rspack/src/browser/service.ts
 M packages/rspack/src/loader-runner/index.ts
 M packages/rspack/src/loader-runner/service.ts
?? tests/rspack-test/configCases/loader-parallel/serialized-data/.

Milliseconds: median [min, max]. Full rebuild forces all JS and CSS resources through their respective loader chains again.

| Version | parallel | Setup + cold build | Cold build | Full rebuild | Cold make | Rebuild make | Samples |
|---|---|---:|---:|---:|---:|---:|---:|
| v2-2-6 | on | 97229.30 [95604.68, 99248.69] | 97218.43 [95594.15, 99238.11] | 98309.80 [97122.61, 101011.24] | 75478.38 [74275.56, 77178.50] | 75392.42 [74914.52, 76211.07] | 5/5 |
| worktree-bec7 | on | 103714.92 [99903.52, 104607.58] | 103703.58 [99892.37, 104596.21] | 100826.21 [99345.40, 101615.90] | 78981.85 [78449.12, 80418.38] | 76937.51 [76636.58, 77527.20] | 5/5 |

| Mode | Branch vs 2.2.6: setup + cold | Branch vs 2.2.6: full rebuild |
|---|---:|---:|
| parallel | 6.67% | 2.56% |

Environment: Node v24.20.0; linux/x64; Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz; 32 logical CPUs (32 available). Negative percentages mean less time.


Failed pairs: 0; no automatic retries.

| Group | Cold / rebuild Babel / CSS / extract pitch calls | Execution thread IDs |
|---|---:|---|
| v2-2-6-parallel-on | 10000 Babel + 10000 CSS + 10000 extract pitch / 10000 Babel + 10000 CSS + 10000 extract pitch | 0, 1, 2, 3, 4, 5, 6, 7, 8 |
| worktree-bec7-parallel-on | 10000 Babel + 10000 CSS + 10000 extract pitch / 10000 Babel + 10000 CSS + 10000 extract pitch | 0, 1, 2, 3, 4, 5, 6, 7, 8 |

Timing: compiler.run invocation through callback; excludes setup/close, stats, audits, bundle evaluation and hashing. setupAndColdBuildMs includes compiler setup because worker boot can start there. Process includes the entire two-build child lifetime and validation overhead.

Validation instruments Babel loader/transform in workers, and css-loader normal plus CSS extract pitch on main. Measured runs contain no audit preload. Every build checks freshly built modules, exact loader chain, resource set and a streaming output hash. Only cold validation builds evaluate the bundle in a separate Node process with a 24 GiB heap limit; exported value and checksum evaluate all generated functions. All later outputs must match the validated hash. Output hashes must match within each version across repetitions. Rspack artifact and Babel/CSS dependency hashes must remain unchanged.

This generated workload combines parallel Babel parse/print with real css-loader and CSS extraction, including nested importModule builds. Diagnostics use per-loader timers and branch native task timings, and are excluded from performance samples. The overhead report distinguishes queue/event-loop waiting from context preparation and merge; concurrent latency sums are not build wall time or CPU time. Whole-build comparisons include changes between versions beyond queue dispatch. Ranges are descriptive; machine activity and OS caches are not controlled. Raw records include setup/process timings and environment.

Sources/lockfile: source/. Native/core hashes, timings, configuration: raw/. Validation thread audits: audit/. Full stats: stats/. Source file hashes: fixture.json. Local source changes: worktree.patch.
