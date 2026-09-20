# Parallel Babel / CSS extraction comparison

Base source revision: `954fd197fd772978a53919b56c22e469c53ebc7e` plus the opt-in timing instrumentation in [worktree.patch](worktree.patch) and [source/rspack](source/rspack/). Both diagnostic and formal runs use the same release artifacts. Formal processes unset RSPACK_LOADER_TIMING_FILE and have no audit preload or module timing hooks.

10,000 JS modules, 1,210–1,212 lines each, plus 10,000 CSS Modules. Every JS runs parallel Babel; every CSS runs css-loader and CSS extract on main. 8 workers; 5 measured pairs per version. Caches disabled.

Medians in seconds:

| Metric | 2.2.6 | Branch | Change |
|---|---:|---:|---:|
| Setup + cold build | 99.885 | 101.957 | +2.07% |
| Full rebuild | 99.335 | 99.632 | +0.30% |

[Performance report](report.md) includes ranges and phase timings. [Overhead diagnostics](diagnostics.md) separates loader body, queue wait, main/worker event-loop wait, main prepare/context work, result merge and Rust restoration. Instrumented diagnostic timings are excluded from the table above.

All per-task native/JS logs, module lifecycle records and joined per-module timings are preserved in [audit.tar.gz](audit.tar.gz). Concurrent latency sums overlap; they are not CPU time and must not be subtracted from build wall time. The branch still awaits a per-task main-thread prepare RPC before takeContext; its wait is part of the callback + main prepare interval.

Original full run with uncompressed audit logs, fixtures, bundles and full stats: `/data00/home/jinzhixin/projects/rspack-bench/results/babel-css-extract-2026-09-20T10-02-46-716Z-2661908`.

Raw samples: [raw/](raw/). Exact harness, lockfile and relevant Rust source snapshot: [source/](source/). Release build: [branch-release-build.log](branch-release-build.log). Machine/Node environment and loaded artifact hashes are in raw records. Babel parses/prints without presets/plugins. Whole-version differences do not isolate the queue as their sole cause.

[Phase breakdown, overhead interpretation and verification](analysis.md).
