# Babel large-file benchmark

Development bundler configuration with release native artifacts. Optimizations, incremental, Rspack caches, loader cache and Babel disk/config caches disabled. Babel parses and generates JavaScript without presets/plugins. Identical explicit worker counts.

Each fresh process creates one compiler: cold build, then full rebuild with all resources marked modified. Serial processes; rotating group order; OS cache retained. Validation and warmup pairs excluded from samples.

10000 modules; 1208-1210 lines per module; 436.17 MiB input; 8 workers. One validation and one warmup pair, then 5 measured pairs per group.

Worktree HEAD: 954fd197fd772978a53919b56c22e469c53ebc7e; status: clean.

Milliseconds: median [min, max]. Full rebuild forces every module through Babel again.

| Version | parallel | Setup + cold build | Cold build | Full rebuild | Cold make | Rebuild make | Samples |
|---|---|---:|---:|---:|---:|---:|---:|
| v2-2-6 | on | 71461.95 [71115.76, 72418.89] | 71451.68 [71105.17, 72408.38] | 71523.26 [70759.09, 72433.49] | 70439.69 [70044.75, 71215.65] | 70252.73 [69484.65, 71181.50] | 5/5 |
| worktree-bec7 | on | 71919.50 [70766.24, 76389.75] | 71907.79 [70755.15, 76379.00] | 70829.52 [69981.65, 72948.23] | 70689.36 [69729.03, 75185.05] | 69483.26 [68867.64, 71750.67] | 5/5 |

| Mode | Branch vs 2.2.6: setup + cold | Branch vs 2.2.6: full rebuild |
|---|---:|---:|
| parallel | 0.64% | -0.97% |

Environment: Node v24.20.0; linux/x64; Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz; 32 logical CPUs (32 available). Negative percentages mean less time.


Failed pairs: 0; no automatic retries.

| Group | Cold / rebuild Babel calls | Execution thread IDs |
|---|---:|---|
| v2-2-6-parallel-on | 10000 / 10000 | 1, 2, 3, 4, 5, 6, 7, 8 |
| worktree-bec7-parallel-on | 10000 / 10000 | 1, 2, 3, 4, 5, 6, 7, 8 |

Timing: compiler.run invocation through callback; excludes setup/close, stats, audits, bundle evaluation and hashing. setupAndColdBuildMs includes compiler setup because worker boot can start there. Process includes the entire two-build child lifetime and validation overhead.

Validation instruments the actual Babel loader and transform in every thread. Measured runs contain no audit preload. Every build checks freshly built modules, exact loader chain, resource set and a streaming output hash. Only cold validation builds evaluate the bundle in a separate Node process with a 24 GiB heap limit; exported value and checksum evaluate all generated functions. All later outputs must match the validated hash. Output hashes must match within each version across repetitions and main/worker settings. Rspack artifact and Babel dependency hashes must remain unchanged.

This is a synthetic large-JavaScript parse/print workload, not an application with a full Babel preset stack. Whole-build comparisons include changes between versions beyond queue dispatch. Ranges are descriptive; machine activity and OS caches are not controlled. Raw records include setup/process timings and environment.

Sources/lockfile: source/. Native/core hashes, timings, configuration: raw/. Validation thread audits: audit/. Full stats: stats/. Source file hashes: fixture.json. Local source changes: worktree.patch.
