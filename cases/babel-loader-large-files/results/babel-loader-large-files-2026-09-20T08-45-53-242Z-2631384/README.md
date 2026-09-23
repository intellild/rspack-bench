# Recorded large-file Babel comparison

Source revision: `954fd197fd772978a53919b56c22e469c53ebc7e` (`codex/loader-runner-mpmc`). Branch built with `pnpm run build:cli:release`; see [build log](branch-release-build.log). Baseline is the pinned published `@rspack/core@2.2.6` native package.

10,000 modules, 1,200+ lines/module, 8 workers, 5 measured samples per group. Both versions use the same Babel dependency versions and disable caches. Medians in seconds; negative changes mean less elapsed time.

| Mode | Metric | 2.2.6 | Branch | Change |
|---|---|---:|---:|---:|
| parallel | Compiler setup + cold build | 71.462 | 71.919 | +0.64% |
| parallel | Full rebuild | 71.523 | 70.830 | -0.97% |

The median differences are below 1% in opposite directions. This run does not show a consistent whole-build speedup for the branch; its setup + cold samples span 70.766–76.390 seconds.

[Full report](report.md) includes ranges, phase timings and validation counts. [Raw samples](raw/) contain effective configuration, exact artifact hashes and environment. [Summary JSON](summary.json) retains every timing sample. [Source snapshot](source/) includes the generator, runner and lockfile. [Audit records](audit/) verify actual Babel execution threads and call counts.

Original full run: `~/projects/rspack-bench/results/babel-loader-large-files-2026-09-20T08-45-53-242Z-2631384`. The original directory also retains generated sources, bundles, job files and full module stats; these bulky reproducible files are omitted from this compact snapshot.

The workload measures Babel parsing and code generation without presets/plugins. This is a whole-version comparison, not proof that the queue alone caused a timing difference. OS caches are retained and background machine activity is uncontrolled.
