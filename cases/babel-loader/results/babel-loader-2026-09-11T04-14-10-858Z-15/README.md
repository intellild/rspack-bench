# babel-loader results: September 11, 2026

`pnpm bench:babel-loader --modules 10000 --runs 5`

Local worktree: `/data00/home/jinzhixin/.codex/worktrees/0385/rspack`. HEAD: `0c244ef4114d0209bea0e40a684b6fd777609562`. Actual compiled artifacts are identified by hashes in the raw records.

| Version | Baseline, median | Loader, median | Incremental overhead |
|---|---:|---:|---:|
| v2 | 297.55 ms | 6609.23 ms | 6311.68 ms |
| worktree-0385 | 327.73 ms | 6409.69 ms | 6081.96 ms |

The worktree incremental overhead differs by -229.72 ms (-3.64%) from 2.2.3. Loaded-build sample ranges overlap; this run does not establish a statistically significant improvement or regression.

Each of four groups has one validation, one warmup, and five measured builds. All 28 builds pass. Validation records zero loader/compiler calls in the baseline and exactly 10,000 calls with the loader. Measured builds contain no per-module instrumentation.

Babel uses the existing 10,000-module JS graph without presets or plugins. Overhead includes parsing, code generation, loader resolution, and Rust/JS scheduling.

- [report.md](report.md): all phase timings, ranges, and comparisons.
- [summary.json](summary.json): distributions and measured samples.
- [raw/](raw/): all 28 records, configs, loaded dependency versions, artifact hashes, and output checks.
- [metadata.json](metadata.json): worktree state, conditions, and source hashes.
- [fixture.json](fixture.json): input hashes and reuse information.
- [source/](source/): the exact benchmark source and manifests used for this run.

Archived run files are copied unchanged, retaining machine-specific paths. Source hashes refer to the archived snapshot, which may precede compatibility changes in the current shared runner. Generated fixtures, outputs, detailed stats, jobs, and logs stay in the ignored original result directory; references to them in the report describe the complete generated run.
