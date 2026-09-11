# splitChunks.name results: September 11, 2026

`pnpm bench:split-chunks-name --modules 10000 --runs 5`

The a77f workerFunction variant is unsupported for splitChunks.name: the loaded implementation throws `workerFunction must be prepared by Rspack before use`. The table contains ordinary JS callbacks, not worker execution.

| Version | Static name, median | Callback, median | Incremental build cost | Incremental seal cost |
|---|---:|---:|---:|---:|
| v2-1-0 | 345.56 ms | 741.67 ms | 396.11 ms | 392.68 ms |
| v2 | 352.31 ms | 651.60 ms | 299.29 ms | 315.90 ms |
| worktree-a77f | 350.10 ms | 751.40 ms | 401.30 ms | 404.01 ms |

Local worktree: `/data00/home/jinzhixin/.codex/worktrees/a77f/rspack`, HEAD `bbb58b8516649f14c896399db802031151bb0057`. The compiled local artifact reports 2.2.1; core/native hashes identify the actual build.

Validation confirms 10,000 name invocations and complete shared-chunk membership in each callback group. It records 80 microtask turns for 2.2.3, versus 10,000 for both 2.1.0 and a77f. Measured callbacks have no instrumentation. Outputs are byte-identical across naming modes and repetitions within each version.

All 42 supported builds pass: six validations, six warmups, and 30 measured builds. The worker capability attempt is stored separately and has no performance sample. Seal includes splitChunks plus other sealing work; the figures are descriptive whole-build differences.

- [report.md](report.md): phase timing ranges and comparisons.
- [summary.json](summary.json): all measured timing distributions.
- [worker-function-status.json](worker-function-status.json): actual unsupported-worker error and loaded artifacts.
- [raw/](raw/): all build records and effective configurations.
- [metadata.json](metadata.json): run settings, worktree state, and source hashes.
- [fixture.json](fixture.json): hashes of the reused 10,000-module fixture.
- [source/](source/): exact benchmark source and manifests used for this run.

Run records are archived unchanged, including machine-specific paths. Generated fixtures, bundles, detailed stats, job files, and logs remain in the original ignored run directory.
