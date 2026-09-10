# Loader hook results: September 10, 2026

```bash
pnpm bench:loader-hook --modules 10000 --runs 5
```

Four groups compare published Rspack 2.2.3 and the local compiled checkout with the loader hook absent or registered as an empty tap. Every module runs one noop JS loader. Each group has one validation build, one warmup, and five measured builds.

| Version | No hook, median | Empty hook, median | Hook overhead |
|---|---:|---:|---:|
| 2.2.3 | 1417.86 ms | 1443.31 ms | +25.45 ms (+1.8%) |
| local | 1454.07 ms | 1831.63 ms | +377.55 ms (+26.0%) |

The local make interval increases by 374.33 ms. Validation records 10,000 noop calls in every group, 10,001 hook calls with the tap in 2.2.3, and 10,000 in local. These measurements compare whole builds; they do not attribute time to individual internal operations.

- [report.md](report.md): full timing table, ranges, comparisons, and measurement boundaries.
- [summary.json](summary.json): metric distributions and all measured timing samples.
- [raw/](raw/): all 28 worker records, including validation, warmups, effective configs, environment, loaded artifact hashes, and output checks.
- [metadata.json](metadata.json): run settings, timestamps, and source hashes.
- [fixture.json](fixture.json): hashes for the 10,000 generated modules.
- [source/](source/): exact benchmark source and manifests used for this run, matching `metadata.json`.

Recorded files are copied unchanged from the original run. Absolute paths describe that machine and are retained as provenance. The source snapshot predates the case directory reorganization; subsequent path and documentation changes were not used to produce these timings. To use the snapshot, copy its contents into a separate benchmark checkout and install the pinned dependencies. The local build is identified by its recorded core and native artifact hashes.

Generated fixtures, bundles, detailed stats, job files, and logs remain in the original ignored run directory and are not included in this archive. References to those directories in the original report describe the complete generated run.
