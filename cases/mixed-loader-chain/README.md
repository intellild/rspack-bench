# Mixed JS loader chain

Compares Rspack 2.1.0, 2.2.3, and the compiled local a77f checkout using three independent synchronous noop JS loaders on the existing 10,000-module JS graph.

```bash
pnpm bench:mixed-loader-chain --modules 10000 --runs 5
```

| Mode | Configured `use` order: left, middle, right | Normal execution |
|---|---|---|
| main | `false, false, false` | main → main → main |
| mixed | `false, true, false` | main → worker → main |
| parallel | `true, true, true` | worker → worker → worker |

Normal loaders execute right to left. All loaders return their input unchanged and have no pitch function. Every loader has `options: {}`, required by the published versions for parallel execution. The mixed case measures transitions around the middle loader; main provides a three-loader baseline and parallel checks the cost of keeping the whole chain on workers. Noop results describe orchestration overhead, not throughput for expensive transformations.

[config.mjs](config.mjs) uses development mode, with all optimizations, all Rspack caches, loader `use.cache`, source maps and incremental builds disabled. Version 2.1.0 omits unsupported cache options. Every variant uses the same loader sources and input graph. Default worker counts are retained; `RSPACK_LOADER_WORKER_THREADS` can override them.

Each fresh process performs a cold build and a full rebuild using the same compiler. All 10,000 resources are marked modified before rebuilding; all must be built again. Every validated group has one validation pair, one warmup pair and five measured pair attempts. Processes run serially with rotating group order. Failures are retained, excluded from timing distributions and never automatically retried. The command writes the final report and exits nonzero if any pair fails.

[audit-preload.cjs](audit-preload.cjs) is used only during validation. It checks exactly 10,000 calls per loader per build, complete resource coverage, right-to-left execution order and the expected main/worker thread for each loader. Measured builds have no invocation counters. All builds check the three-loader chain, rebuilt module count, output hash and exported sum of 49,995,000. Outputs must match across modes within each version.

Build timing covers `compiler.run()` through its callback; setup, close, audits, stats, output execution and hashing are excluded. Full rebuilds reuse workers and runtime state but no module or loader results. Local a77f starts workers when Rspack loads, so some startup work can overlap artifact hashing before the build timer. Pair process time includes both builds and all surrounding work. OS caches are retained.

Results are written to `results/mixed-loader-chain-<session>/`, including raw records, per-phase timings, compressed stats, validation logs, source snapshots, fixture hashes and local artifact hashes. `results/latest-mixed-loader-chain.txt` identifies the latest completed run. `--resume results/<run>` continues unattempted pairs while retaining completed and failed attempts.

## Recorded results

[10,000-module comparison from September 15, 2026](results/mixed-loader-chain-2026-09-15T05-46-02-699Z-16/README.md).

The recorded local mixed group has two failed full rebuilds out of five measured pairs, plus a separate all-parallel warmup failure. Consult the failure evidence and successful sample counts alongside timings.

[Dispatch analysis](results/mixed-loader-chain-dispatch-diagnostic-2026-09-15/README.md) counts runner entries and main-thread options requests for all three modes.
