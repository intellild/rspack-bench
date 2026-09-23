# Parallel Babel / builtin CSS comparison

Base source revision: `b4222b41b713ca4e99d886d213c95e4cc7302a90` plus V8 native byte storage, skipped parallel loader hooks and a combined bridge response in [worktree.patch](worktree.patch) and [source/rspack](source/rspack/). Both diagnostic and formal runs use the same release artifacts. Formal processes unset RSPACK_LOADER_TIMING_FILE and have no audit preload or module timing hooks.

10,000 JS modules, 1,210–1,212 lines each, plus 10,000 CSS Modules. Every JS runs parallel Babel; every CSS uses the builtin css/module parser and generator. 8 workers; 5 measured pairs per version. Caches disabled.

The branch took 1.08% longer for setup + cold build and 0.38% less time for full rebuild. Sample ranges overlap; this run does not demonstrate a consistent whole-build improvement.

Medians in seconds:

| Metric | 2.2.6 | Branch | Change |
|---|---:|---:|---:|
| Setup + cold build | 73.662 | 74.456 | +1.08% |
| Full rebuild | 74.538 | 74.254 | -0.38% |

This workload replaces css-loader and CSS extraction with builtin CSS. Historical CSS extract results use a different workload and cannot establish an isolated hook-bypass speedup.

[Performance report](report.md) includes ranges and phase timings. [Overhead diagnostics](diagnostics.md) separates loader body, queue wait, main/worker event-loop wait, main prepare/context work, result merge and Rust restoration. Instrumented diagnostic timings are excluded from the table above.

All per-task native/JS logs, module lifecycle records and joined per-module timings are preserved in [audit.tar.gz](audit.tar.gz). Concurrent latency sums overlap; they are not CPU time and must not be subtracted from build wall time. The branch skips NormalModule loader hooks for worker tasks. It still awaits one per-task main request for the compiler/compilation/buildInfo bridge; that response includes the bridge data, eliminating the separate synchronous getMainObject request. The callback + main prepare interval includes this combined response. The native release binary and Rust implementation are unchanged from the previous V8 experiment.

Original full run with uncompressed audit logs, fixtures, bundles and full stats: `~/projects/rspack-bench/results/babel-builtin-css-2026-09-20T13-59-05-537Z-2791392`.

Raw samples: [raw/](raw/). Exact harness, lockfile and relevant Rust source snapshot: [source/](source/). Release build: [branch-release-build.log](branch-release-build.log). Machine/Node environment and loaded artifact hashes are in raw records. Babel parses/prints without presets/plugins. Whole-version differences do not isolate the queue as their sole cause.

[Phase breakdown, overhead interpretation and verification](analysis.md).
