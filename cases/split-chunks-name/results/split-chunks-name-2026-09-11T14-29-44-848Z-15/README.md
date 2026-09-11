# splitChunks.name workerFunction results: September 11, 2026

`pnpm bench:split-chunks-name --modules 10000 --runs 5`

The modified a77f checkout supports workerFunction for both top-level and cache-group splitChunks names. This benchmark uses the top-level name. The local native binding was built with `pnpm run build:binding:release` (the repository release profile: opt-level 3, fat LTO); JavaScript artifacts were rebuilt from the same checkout. The build configuration remains development mode with all other configurable optimizations disabled.

| Version / name mode | Static build, median | Build, median | Additional build cost | Additional seal cost |
|---|---:|---:|---:|---:|
| v2-1-0 / callback | 349.30 ms | 768.38 ms | 419.08 ms | 418.08 ms |
| v2 / callback | 367.34 ms | 681.49 ms | 314.15 ms | 313.07 ms |
| worktree-a77f / callback | 354.53 ms | 782.94 ms | 428.41 ms | 418.95 ms |
| worktree-a77f / worker | 354.53 ms | 692.61 ms | 338.07 ms | 140.02 ms |

Worker validation observed 10,000 calls on 31 worker threads, with all 10,000 fixture resources covered. The pool uses its default 31 workers; no worker-count environment override was set. The worker callback receives owned snapshots, and all calls return the same name as the ordinary callback.

Local worker build median: 692.61 ms, versus 782.94 ms for the local ordinary callback. Worker process median: 3347.37 ms, versus 3367.89 ms for the local ordinary callback. Every sample starts a fresh process and worker pool. Process time includes startup; build time may overlap startup. This trivial constant-return function measures dispatch overhead and does not establish performance for CPU-intensive naming functions.

All 49 builds pass: seven validations, seven warmups, and 35 measured builds. Each build has exactly 10,000 loader-free JS modules, all extracted into the shared chunk, and exports the expected sum (49,995,000). Outputs are byte-identical across naming modes and repetitions within each version. Instrumentation is absent from measured callbacks.

Local checkout: `/data00/home/jinzhixin/.codex/worktrees/a77f/rspack`, based on HEAD `bbb58b8516649f14c896399db802031151bb0057` with the implementation changes in [worktree.patch](worktree.patch). The compiled local version reports 2.2.1; hashes identify the actual core, native binding and worker entry.

- [report.md](report.md): phase timings, sample ranges, and callback microtask turns.
- [summary.json](summary.json): measured distributions and comparisons.
- [worker-function-status.json](worker-function-status.json): successful worker validation and thread IDs.
- [raw/](raw/): every build record, environment and effective configuration.
- [metadata.json](metadata.json): source hashes and local worktree state.
- [fixture.json](fixture.json): reused fixture hashes.
- [source/](source/): exact benchmark source and dependency manifests.

Run records are archived unchanged, including machine-specific paths. Generated fixtures, bundles, detailed stats, job files and logs remain in the original ignored run directory. Samples are descriptive whole-build measurements; background machine activity and OS caches are uncontrolled.
