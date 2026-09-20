# Mixed JS loader chain results: September 15, 2026

`pnpm bench:mixed-loader-chain --modules 10000 --runs 5`

Three independent synchronous noop JS loaders with identical empty options. All caches, optimizations, source maps and incremental builds are off. Local a77f is based on `b96dae3430811bf8587308b4186c817561510578`; core, worker and release native artifacts are identified by hashes in raw records.

Median milliseconds, **cold / full rebuild**, with successful / attempted measured pairs.

| Version | All main: false/false/false | Mixed: false/true/false | All worker: true/true/true |
|---|---:|---:|---:|
| 2.1.0 | 1660.59 / 1204.09 (5/5) | 4100.19 / 3359.23 (5/5) | 4192.01 / 3327.95 (5/5) |
| 2.2.3 | 1783.96 / 1164.64 (5/5) | 4440.25 / 3431.19 (5/5) | 4178.87 / 3217.87 (5/5) |
| Local a77f | 1933.23 / 1330.41 (5/5) | 5126.01 / 4379.67 (3/5) | 3233.70 / 2672.50 (5/5) |

120 builds in completed pairs across 63 attempted pairs; 3 failed pairs, retained without automatic retries. Validation checks every loader call, thread placement, exact right-to-left order and all 10,000 resources on both builds. Each successful build has 10,000 freshly built modules and exports 49,995,000. Outputs match across modes within each version.

The full rebuild marks all resources modified and invokes all three loaders again; only compiler/worker/runtime state is reused. Mixed mode executes right loader on main, middle on worker, then left on main. Noops expose orchestration and transition costs rather than useful transform throughput.

Build timings exclude setup, stats, audits, output evaluation and artifact hashing. Local worker prewarming may overlap work before the build timer; consult pair process timings in report.md as well. Each pair runs in a fresh process, with rotating group order. Results are descriptive, with uncontrolled background activity and retained OS caches.

- [report.md](report.md): sample ranges, make timings and deltas against all-main.
- [summary.json](summary.json), [raw/](raw/): distributions, effective configs, per-build validation and artifact hashes.
- [source/](source/), [metadata.json](metadata.json), [fixture.json](fixture.json): benchmark inputs and hashes.
- [setup-correction/](setup-correction/): the initial omitted-options configuration was rejected by published versions; corrected runs give every loader options: {}. These initial records are excluded from this comparison.

Full compressed stats, emitted bundles and per-thread validation logs remain in the original ignored results directory. Raw records are archived unchanged, including machine-specific paths.

## Local failures

All three failed pairs completed the cold build but failed on the full rebuild. Those three cold builds are retained in raw records, bringing the actual completed-build count to 123; both states of failed pairs are excluded from timing distributions. The metadata `successfulBuilds` field counts only builds in completed pairs (120). Report wording was clarified after the run; raw measurements and the original source snapshot are unchanged.

| Attempt | Failed state | Module errors |
|---|---|---:|
| local all-parallel warmup | full rebuild | 634 |
| local mixed measurement 2 | full rebuild | 395 |
| local mixed measurement 4 | full rebuild | 427 |

The errors report `The original reference that WeakReference<rspack_binding_api::compilation::JsCompilation> is pointing to is dropped` from the local worker entry. See [failure-evidence/](failure-evidence/) for compressed error stats and [failures.json](failures.json) for raw failure records. No Rspack implementation or artifact was changed and no failed pair was retried. Local mixed medians describe the three successful pairs out of five measured attempts, conditional on completion. This failure also occurs with loader cache disabled.
