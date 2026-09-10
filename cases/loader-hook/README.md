# NormalModule loader hook benchmark

Compares published Rspack 2.2.3 with the compiled checkout linked by `versions/local`.

```bash
pnpm smoke:loader-hook
pnpm bench:loader-hook --modules 10000 --runs 5
```

The independent fixture contains 10,000 plain JavaScript modules by default, connected by binary-tree imports. Every module, including the entry, uses exactly one `loaders/noop.cjs`. It does not use React, CSS, SWC, or parallel loaders. The fixture is generated under the result directory, leaving the React fixture untouched.

| Version | Configuration |
|---|---|
| 2.2.3 | No loader hook registered by the benchmark |
| local | No loader hook registered by the benchmark |
| 2.2.3 | Empty `NormalModule.getCompilationHooks(compilation).loader` tap |
| local | Empty `NormalModule.getCompilationHooks(compilation).loader` tap |

The tap is registered inside `compiler.hooks.compilation`. Development mode, disabled caching/incremental builds, and disabled optimization flags are identical across groups. The configuration is in [config.mjs](config.mjs).

Each group runs one correctness check, one warmup, and five measured builds in fresh Node processes. Measured group order rotates. Build timing covers `compiler.run()` through its callback. Compiler setup/close, stats, output execution, and artifact hashing are excluded; process lifetime is reported separately.

Validation counts noop and hook calls, checks all resources and the exact loader chain, and executes the bundle to verify the sum of module values. Actual hook invocation counts are recorded, including duplicates. Measured hook callbacks are empty and loader counters are absent. Output hashes must match across hook settings and repetitions within each version. Loaded core and binding paths and hashes must remain unchanged throughout the run.

`report.md` and `summary.json` report hook overhead (on minus off), local/published ratios, and the difference between the two versions' hook overheads. These whole-build measurements do not isolate a single source change. Full configs, samples, environment, stats, fixtures, and outputs are saved under `results/loader-hook-<session>/`; `results/latest-loader-hook.txt` points to the latest completed case.

## Recorded results

The [10,000-module run from September 10, 2026](results/loader-hook-2026-09-10T11-32-05-509Z-15/README.md) includes the report, all samples, input hashes, and the source snapshot used for that run.
