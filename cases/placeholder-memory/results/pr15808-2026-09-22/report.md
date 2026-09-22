# PR #15808 Rust memory comparison

main: `cb9a731cf375d5f65d046ea08219812ca8fa33c5`; branch: `61bde4be5db26709df773f061766793dce702122`.

Fixture scale: 1000 generated units per configuration (not total graph modules); 32 CSS rules per module (+ one inline rule); 5 fresh-process cold builds/version/scenario; Rayon/loader/libuv pools set to 8; Tokio uses its default worker count. Audit builds excluded. Medians below.

Rust requested heap only: identical GlobalAlloc counters around mimalloc; Node/V8, allocator metadata, fragmentation, stack and direct C allocations excluded. Peak is the absolute live-byte high watermark from compiler construction through compiler.run callback; live is sampled at that callback before stats conversion/validation/close. Allocation volume counts alloc/alloc_zeroed sizes and full successful realloc requested sizes. Internal temporary realloc overlap is not measured.

One shared compiled JS wrapper is used with two exact native binaries. Native SHA-256, all compiled JS SHA-256, source revisions, instrumentation patches, environment and raw samples are archived. Both builds use release opt-level=3, LTO off, 16 codegen units, info-level, identical third-party dependency versions and allocator. Atomic instrumentation affects time, so elapsed time is diagnostic only.

| Scenario | Main peak (MiB) | PR branch peak (MiB) | Peak change | Main live (MiB) | PR branch live (MiB) | Main allocated (MiB) | PR branch allocated (MiB) | Allocation change |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Runtime templates | 39.32 | 39.19 | -0.33% | 36.09 | 35.92 | 163.93 | 163.16 | -0.47% |
| Native CSS + SRI | 248.10 | 246.75 | -0.54% | 225.63 | 224.94 | 1082.10 | 1062.20 | -1.84% |
| CSS extraction: auto public path + SRI | 171.21 | 171.26 | +0.03% | 162.43 | 160.85 | 1882.85 | 1852.52 | -1.61% |
| CSS extraction: relative public path | 173.85 | 173.65 | -0.11% | 161.05 | 161.11 | 1864.47 | 1834.01 | -1.63% |
| Relative URLs | 38.39 | 38.37 | -0.06% | 35.20 | 35.20 | 154.39 | 153.79 | -0.39% |
| Static URLs and workers | 41.13 | 38.15 | -7.25% | 38.59 | 35.60 | 152.54 | 145.92 | -4.34% |
| Modern-module output | 105.05 | 102.01 | -2.89% | 99.52 | 96.48 | 495.26 | 487.29 | -1.61% |
| ESM with preserved asset imports | 77.26 | 74.27 | -3.87% | 70.90 | 68.00 | 368.69 | 361.68 | -1.90% |
| Rstest mock hoisting | 35.68 | 35.71 | +0.08% | 32.48 | 32.51 | 4784.89 | 4781.17 | -0.08% |
| Node externals | 32.94 | 32.84 | -0.29% | 29.83 | 29.77 | 166.14 | 165.70 | -0.27% |

Per-scenario peaks must not be summed: scenarios run in independent processes. See summary.json for baseline-adjusted metrics, allocation counts and min/max spread.

All emitted files are checked for unresolved placeholders. Output SHA-256 must match between versions and every measured build. Additional assertions check lazy CSS, CSS text, module IDs, relative publicPath, inline assets, SRI algorithms, worker files, preserved ESM asset imports, dynamic ESM links, all four Rstest operations and Node external forms. Audit raw files contain generated-source, early processAssets and executed CSS-loader marker counts.

## Interpretation

The clearest peak reductions are URL/Worker (-7.25%, about 2.98 MiB), modern-module (-2.89%, about 3.04 MiB), and ordinary ESM with preserved asset imports (-3.87%, about 2.99 MiB). Their five-sample peak ranges do not overlap.

Native CSS has a -0.54% peak median, but ranges overlap; extracted CSS, Rstest and Node external also have overlapping ranges. Their small peak deltas should not be interpreted as established improvements/regressions. All ten allocation-volume medians decrease; the largest relative decrease is URL/Worker (-4.34%). CSS allocation volume decreases about 1.6–1.8%.

Rstest deliberately stresses 1000 groups of four hoisted operations in one test entry. Its roughly 4.7 GiB cumulative allocation volume is churn across the build, not simultaneous memory: live/peak remain about 33/36 MiB.

| Scenario | Main peak range (MiB) | PR branch peak range (MiB) |
|---|---:|---:|
| Runtime templates | 39.22–39.38 | 39.13–39.21 |
| Native CSS + SRI | 247.29–248.30 | 246.36–248.69 |
| CSS extraction: auto public path + SRI | 171.13–171.37 | 171.12–171.43 |
| CSS extraction: relative public path | 173.61–174.31 | 173.56–173.74 |
| Relative URLs | 38.38–38.42 | 38.36–38.43 |
| Static URLs and workers | 41.08–41.16 | 38.07–38.17 |
| Modern-module output | 104.92–105.10 | 101.91–102.09 |
| ESM with preserved asset imports | 77.22–77.42 | 74.24–74.45 |
| Rstest mock hoisting | 35.65–35.81 | 35.50–35.72 |
| Node externals | 31.65–34.00 | 31.68–33.95 |

## Validation and archived data

- 20 audit builds + 100 measured builds passed; every emitted file's SHA-256 matches across both revisions and all rounds.
- Audit output proves intermediate URL/Worker, ESM, SRI, Rstest, native CSS and all four extract-CSS placeholder forms occur. Runtime-template coverage asserts the final expression rendered from `on_chunk_loaded.ejs`; CSS output checks `[id]` identifiers and all 1000 style modules.
- An independent allocator check passed alloc, alloc_zeroed, realloc growth/shrinkage, free, high-water mark and cumulative-volume/count assertions.
- All PR-modified source snapshots match the pinned Git blobs. Main and branch use byte-identical instrumentation patches.
- `summary.json`: medians, min/max, allocation counts and baseline-adjusted metrics.
- `samples.json.gz`: all 120 unmodified raw sample records, including output hashes and audit marker counts.
- `metadata.json`: exact native/core/loader hashes, source revisions, toolchain, arguments and machine details.
- `source/`: the scripts used, documentation, identical instrumentation patches and counter-check source.
- `build-logs.txt.gz`: successful main and branch build logs.

The executable binaries and generated fixture remain in the original ignored build/results directories recorded in metadata. Rspack's PR checkout was not modified.
