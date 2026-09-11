# less-loader results: September 11, 2026

`pnpm bench:less-loader --modules 10000 --runs 5`

Local worktree: `/data00/home/jinzhixin/.codex/worktrees/0385/rspack`. HEAD: `0c244ef4114d0209bea0e40a684b6fd777609562`. Actual compiled artifacts are identified by hashes in the raw records.

| Version | Baseline, median | Loader, median | Incremental overhead |
|---|---:|---:|---:|
| v2 | 303.60 ms | 6277.60 ms | 5974.00 ms |
| worktree-0385 | 320.92 ms | 6200.20 ms | 5879.27 ms |

The worktree incremental overhead differs by -94.72 ms (-1.59%) from 2.2.3. Loaded-build sample ranges overlap; this run does not establish a statistically significant improvement or regression.

Each of four groups has one validation, one warmup, and five measured builds. All 28 builds pass. Validation records zero loader/compiler calls in the baseline and exactly 10,000 calls with the loader. Measured builds contain no per-module instrumentation.

Less reuses all 10,000 stylesheets from the repository and adds one importing JS entry. The baseline CSS is precompiled outside timers. Every build emits 30,000 checked CSS rules, byte-identical across versions and pipelines. Overhead includes Less compilation and loader integration.

- [report.md](report.md): all phase timings, ranges, and comparisons.
- [summary.json](summary.json): distributions and measured samples.
- [raw/](raw/): all 28 records, configs, loaded dependency versions, artifact hashes, and output checks.
- [metadata.json](metadata.json): worktree state, conditions, and source hashes.
- [fixture.json](fixture.json): input hashes and reuse information.
- [source/](source/): the exact benchmark source and manifests used for this run.

Archived run files are copied unchanged, retaining machine-specific paths. Source hashes refer to the archived snapshot, which may precede compatibility changes in the current shared runner. Generated fixtures, outputs, detailed stats, jobs, and logs stay in the ignored original result directory; references to them in the report describe the complete generated run.
