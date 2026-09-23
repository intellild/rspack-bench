# Parallel Babel + builtin CSS

Compare Rspack 2.2.6 with the release artifact from `codex/loader-runner-mpmc`. Defaults: 10,000 JS modules with 1,200+ executable lines each, one CSS Module per JS, 8 Babel workers, 5 measured cold/full-rebuild pairs per version.

```sh
pnpm bench:babel-builtin-css
pnpm bench:babel-builtin-css --modules 24 --runs 1 --diagnostic-only
```

```text
Large JS module → parallel babel-loader (parse/print, no presets/plugins)
       ↓ imports named class
CSS Module → builtin css/module parser and generator → main.css
```

`experiments.css` is enabled. CSS uses no JS loader, CSS extract plugin, or nested importModule. The generated fixture matches the existing Babel/CSS-extract fixture, including scoped class checks. Each build validates 10,000 freshly built Babel modules, 10,000 freshly built native CSS modules with no loader chain, zero CSS JS proxies, CSS rules, and JS/CSS output hashes. Cold diagnostic bundles are evaluated in a separate process to validate all generated functions and CSS exports.

Optimizations, incremental, Rspack caches and Babel caches/config loading are disabled. One diagnostic pair and one discarded warmup pair per version precede five measured pairs in rotating order. Each full rebuild marks all 20,000 resources modified. Formal runs have no audit preload or native timing logs. Build timing excludes output validation and hashing.

Diagnostics preserve Babel loader/transform body timings, CSS module lifecycle latency and branch native task timings: dispatch, queue, event loop, main bridge preparation, context, JS residual, merge and restore. Native diagnostics assert that CSS dispatches no JS tasks. Concurrent task latency sums are not CPU time or build wall time.

The branch includes V8 bytes for options/additionalData and skips NormalModule.loader hooks in worker pitch/normal stages. One main bridge preparation request remains; compiler/compilation/buildInfo proxies and logger RPC still use main. Whole-version comparisons do not isolate queue performance. Results from CSS extract workloads are not directly comparable to this workload.

Build the Rspack release binding and JS artifacts before running. Pinned dependencies: babel-loader 10.1.1 and @babel/core 7.29.7. Sources, artifact hashes, raw samples, audits and configuration are recorded in each result directory.

## Recorded results

[10,000-module builtin CSS comparison](results/babel-builtin-css-2026-09-20T13-59-05-537Z-2791392/README.md).
