# Placeholder replacement: Rust memory

Compares Rspack PR [#15808](https://github.com/web-infra-dev/rspack/pull/15808) against main. This is one benchmark suite with ten configurations because CSS extraction, native CSS, Node targets, Rstest and modern-module output require different build settings.

## Coverage

| Configuration | PR paths covered | Verification |
| --- | --- | --- |
| `runtime-template` | `rspack_core/src/runtime_template.rs` runtime-global placeholder parsing | 16 independent runtime chunks; assert the rendered `Object.keys(__webpack_require__.O).every(...)` expression from `on_chunk_loaded.ejs` |
| `css-native-sri` | CSS asset publicPath conversion, CSS render publicPath, `[id]` local identifiers, CSS text exports, SRI | Style CSS uses `[id]`, text CSS uses `[name]` to include both hit and no-match identifier paths; normal/resource/inline URLs; synchronous and lazy CSS/JS |
| `css-extract-auto-sri` | Extract absolute-publicPath, auto-publicPath and base-URI replacements; SRI | CSS-loader executed exports contain intermediate markers; nested `css/` output; asset-specific empty publicPath triggers base URI |
| `css-extract-relative` | Extract absolute-publicPath, escaped single-dot and base-URI replacements | Loader publicPath `../cdn.v1/`; verify restored dots and final asset paths |
| `url-relative` | Ordinary relative-URL rendering and placeholder no-match scanning | `new URL(..., import.meta.url)` with parser `url: 'relative'` |
| `url-worker` | Numeric static asset/Worker placeholder parsing and ordinary JS auto-publicPath replacement | `url: 'new-url-relative'`, `worker.url: 'new-url-relative'`; assert asset/Worker markers before rendering and worker outputs |
| `modern-module` | ESM chunk references and final ESM auto-publicPath replacement | Concatenated ESM, CommonJS modules, preserved asset imports, dynamic chunks, static URLs and Workers |
| `module-preserve` | Ordinary JS renderer's preserved asset import/publicPath paths | `library.type: 'module'`, no concatenation, `asset/resource` with `importMode: 'preserve'` |
| `rstest` | MOCK / UNMOCK / MOCKREQUIRE / HOISTED flag parsing and relocation | One generated test entry with distinct offsets, plus local dependencies; assert intermediate markers, generated operations and no residual markers |
| `node-external` | `is_node_external`, bare builtins, `node:` prefix, `pnpapi`, local negative case | Require `fs`, `node:fs`, `assert/strict`, an unknown `node:` request, `pnpapi` and aliased `./node:local`; verify local code is bundled |

Normal asset URLs, inline assets and ordinary source also exercise scanners that find no match. Both versions must emit byte-identical outputs. Every sample checks SHA-256 against the audit output, checks all expected features and rejects unexpanded placeholders. Audit processes inspect generated code, early processAssets and executed CSS-loader exports; these hooks are disabled in measured processes.

## Reproduce

Use an existing checkout with installed JS dependencies and a built `packages/rspack/dist/index.js`. The shared JS wrapper must be compatible with both native revisions. The measured main commit differs from the PR base only in JS type declarations and test configuration; the relevant JS runtime implementation is unchanged.

```sh
# Refresh origin/main in the source checkout first, then pin both revisions.
python3 cases/placeholder-memory/prepare.py \
  --rspack /absolute/path/to/rspack \
  --work /absolute/path/to/large-disk/placeholder-memory-build \
  --main origin/main --branch codex/memmem-placeholders

pnpm bench:placeholder-memory \
  --builds /absolute/path/to/large-disk/placeholder-memory-build/builds.json \
  --core /absolute/path/to/rspack/packages/rspack/dist/index.js \
  --dependencies /absolute/path/to/rspack-bench/versions/local \
  --modules 1000 --rules 32 --runs 5 --workers 8
```

The dependencies directory must resolve `css-loader` (the recorded run uses the existing `versions/local` installation). `prepare.py` creates isolated source snapshots; it does not change the Rspack checkout or PR. It replaces the allocator **only in those snapshots**, adds a benchmark-only N-API counter API, and builds both binaries identically with the pinned Rust toolchain, release optimization, LTO off, 16 codegen units and the `info-level` feature. SWC plugin support is not enabled. A shared Cargo target directory reuses third-party dependencies; snapshot mtimes are refreshed to prevent Cargo from reusing an older revision's workspace objects.

Optional `--cases css-native-sri,rstest`, `--versions main` and a smaller `--modules 8 --rules 3 --runs 1` are useful for smoke checks. Results include source snapshots, allocator patches, native and JS checksums, fixed revisions, environment, jobs, raw samples, output checksums, marker counts, summary and report. Generated fixtures and native binaries live in ignored build/result directories. The runner takes the repository's `.bench-running` lock and runs subprocesses sequentially, alternating version order and rotating configuration order between rounds.

## What is measured

Each measured sample is a fresh Node process with caches and incremental compilation disabled. The audit build is excluded and also warms disk caches. Counters start immediately before compiler construction, after loading the native module and JS API; they stop at the `compiler.run` callback, before stats conversion, output verification and `compiler.close`.

- **Peak bytes:** absolute high-water mark of live Rust allocation sizes within this interval. Baseline-adjusted peak is also recorded.
- **Live bytes:** Rust allocations still live at the callback, while compiler/compilation are retained. Baseline-adjusted live bytes are also recorded; this is not a leak measurement.
- **Allocated bytes/count:** successful `alloc`, `alloc_zeroed` and `realloc` requests during the interval. Realloc contributes its full new size to cumulative volume, while live bytes change only by the size difference.

These are requested-byte counters around the existing mimalloc allocator, not process RSS or V8 heap. They exclude allocator bookkeeping/fragmentation, stack memory, direct C allocations and temporary overlap inside realloc. They also exclude initialization before the baseline. A snapshot is taken before allocating its N-API return value; that small API overhead is identical in both versions. All threads contribute through atomics. Instrumentation affects CPU time; elapsed time is diagnostic and is not a production speed comparison.

`--modules` sets the number of generated fixture units; dependencies add further graph modules, and the Rstest case puts its mock groups in one entry. `--workers` sets Rayon, loader and libuv pool sizes; Tokio retains its default.

The report uses medians of five samples and preserves min/max and every raw sample. Small peak differences that overlap sample variability should not be treated as established regressions or improvements. Do not sum the independent configurations' peaks. This synthetic suite compares these specific paths; it is not an application-wide memory claim.

## Recorded comparison

[2026-09-22: main vs PR #15808](results/pr15808-2026-09-22/report.md), 1000 units, 32 CSS rules, five samples/version/configuration. Peak Rust heap medians fall 7.25% for URL/Worker, 2.89% for modern-module, and 3.87% for ordinary ESM with preserved asset imports. Other peak deltas are small; CSS, Rstest and Node external ranges overlap. All ten cumulative allocation-volume medians decrease. The report includes ranges, exact revisions, raw records and reproduction details.
