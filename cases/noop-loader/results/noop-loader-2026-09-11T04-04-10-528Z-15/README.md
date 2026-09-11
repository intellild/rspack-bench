# Noop loader results: September 11, 2026

```bash
pnpm bench:noop-loader --modules 10000 --runs 5
```

The local group uses `/data00/home/jinzhixin/.codex/worktrees/0385/rspack`, with a clean worktree at `0c244ef4114d0209bea0e40a684b6fd777609562`. Actual compiled JS and native artifacts are identified by the hashes in the worker records.

| Version | No loader, median | Noop, median | Loader overhead | Amortized per module |
|---|---:|---:|---:|---:|
| 2.2.3 | 295.22 ms | 1411.84 ms | 1116.62 ms | 111.66 µs |
| worktree-0385 | 324.57 ms | 1444.91 ms | 1120.34 ms | 112.03 µs |

Loader overhead is the difference between median build times with and without noop. The worktree overhead exceeds 2.2.3 by 3.72 ms (0.33%) in this run; the samples do not establish a meaningful overhead regression or improvement. Per-module figures amortize the whole-build difference and are not direct measurements of individual loader calls.

Each of the four groups has one validation build, one warmup, and five measured builds. All 28 builds pass module, loader-chain, and bundle execution checks. Validation counts zero calls in the baseline and exactly 10,000 calls with noop. Measured builds have no loader counters, and no group registers a NormalModule loader hook.

- [report.md](report.md): timing ranges, phase timings, comparisons, and measurement boundaries.
- [summary.json](summary.json): all metric distributions and measured timing samples.
- [raw/](raw/): all 28 worker records with effective configuration, environment, loaded artifact hashes, and output checks.
- [metadata.json](metadata.json): settings, timestamps, worktree state, and source hashes.
- [fixture.json](fixture.json): hashes of all 10,000 input modules.
- [source/](source/): the exact benchmark source and manifests used for this run.

Archived run files are copied unchanged, including machine-specific paths. Source hashes match the archived snapshot; the small-scale test script was subsequently removed from the current root package manifest. The benchmark implementation used for these measurements is unchanged.

Generated fixtures, bundles, detailed stats, jobs, and logs remain in the ignored original run directory. References to these directories in the original report describe the full generated run.
