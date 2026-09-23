# Parallel Babel / CSS extraction comparison

Base source revision: `b4222b41b713ca4e99d886d213c95e4cc7302a90` plus the V8 native byte storage experiment in [worktree.patch](worktree.patch) and [source/rspack](source/rspack/). Both diagnostic and formal runs use the same release artifacts. Formal processes unset RSPACK_LOADER_TIMING_FILE and have no audit preload or module timing hooks.

10,000 JS modules, 1,210–1,212 lines each, plus 10,000 CSS Modules. Every JS runs parallel Babel; every CSS runs css-loader and CSS extract on main. 8 workers; 5 measured pairs per version. Caches disabled.

Medians in seconds:

| Metric | 2.2.6 | Branch | Change |
|---|---:|---:|---:|
| Setup + cold build | 97.229 | 103.715 | +6.67% |
| Full rebuild | 98.310 | 100.826 | +2.56% |

[Performance report](report.md) includes ranges and phase timings. [Overhead diagnostics](diagnostics.md) separates loader body, queue wait, main/worker event-loop wait, main prepare/context work, result merge and Rust restoration. Instrumented diagnostic timings are excluded from the table above.

All per-task native/JS logs, module lifecycle records and joined per-module timings are preserved in [audit.tar.gz](audit.tar.gz). Concurrent latency sums overlap; they are not CPU time and must not be subtracted from build wall time. The branch still awaits a per-task main-thread prepare RPC before takeContext; its wait is part of the callback + main prepare interval.

Original full run with uncompressed audit logs, fixtures, bundles and full stats: `~/projects/rspack-bench/results/babel-css-extract-2026-09-20T11-37-49-482Z-2750617`.

Raw samples: [raw/](raw/). Exact harness, lockfile and relevant Rust source snapshot: [source/](source/). Release build: [branch-release-build.log](branch-release-build.log). Machine/Node environment and loaded artifact hashes are in raw records. Babel parses/prints without presets/plugins. Whole-version differences do not isolate the queue as their sole cause.

[Phase breakdown, overhead interpretation and verification](analysis.md).

[V8 transport and comparison with the previous branch run](v8-comparison.md).
