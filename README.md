# Rspack Less / CSS benchmark

Compares `@rspack/core@1.7.11` and `@rspack/core@2.2.3` using a shared fixture of 10,000 style files. Each version has its own dependencies and lockfile under `versions/`.

Dependencies are pinned to `zx@8.8.5`, `less-loader@13.0.0`, `less@4.9.1`, and `css-loader@7.1.5`. Requires Node.js 22.11.0 or later.

## Run

```bash
npm ci
npm ci --prefix versions/v1
npm ci --prefix versions/v2
npx zx bench.mjs --modules 10000 --runs 5 --supplement always
```

| Option | Default | Description |
|---|---|---|
| `--modules` | `10000` | Number of style files |
| `--runs` | `5` | Measured builds per group |
| `--styles` | `less` | Input syntax: `less` or `css` |
| `--supplement` | `auto` | Additional comparisons: `auto`, `always`, or `never` |

`always` runs every comparison; `never` runs only the native and noop groups. `auto` selects additional comparisons based on the input syntax and measured results.

`npm run smoke` and `npm run smoke:css` check all Less and CSS paths respectively, using 24 files and one measured build per group.

## Fixture and comparisons

The entry statically imports every style file. Each file produces a unique class with three CSS rules and three declarations per rule. Less inputs use variables, a parametric mixin, nested selectors, and arithmetic. The fixture contains no `@import`, images, or fonts.

Each pipeline runs against both Rspack versions:

| Group | Less pipeline | CSS pipeline |
|---|---|---|
| Native | less-loader → native CSS | Native CSS |
| Noop | less-loader → noop → native CSS | noop → native CSS |
| Extract | less-loader → css-loader → CssExtractRspackPlugin | css-loader → CssExtractRspackPlugin |

The extraction comparison also supports a layered entry with shared style dependencies: entry → sections → groups → styles. Every run regenerates `fixture/`.

## Measurement

All builds use development mode with source maps, caching, incremental builds, parallel loaders, and configurable optimizations disabled. Module and chunk IDs use `natural`. Each build runs in a fresh Node.js process and writes to a separate output directory. OS file caches remain intact.

Each group runs one correctness check, one warmup, and five measured builds by default. Measurements run serially with rotating group order. Correctness checks verify module counts, loader and Less compilation counts, expanded CSS declarations, and output consistency. Per-module counters are enabled only during validation.

Build time covers `compiler.run()` through its callback. Hook intervals record make → finishMake, finishMake → seal, seal → afterSeal, and emit → afterEmit. Process lifetime is measured separately. Dependency installation, fixture generation, compiler setup/close, and detailed stats generation are excluded from build time.

## Results

Each run writes to `results/<session>/`:

- `report.md`: medians, ranges, version ratios, and the cost of adding noop.
- `summary.json` and `raw/`: aggregated metrics and individual build records, including effective configuration and loaded dependency versions.
- `stats/`, `output/`, and `logs/`: detailed stats, generated bundles, and worker logs.
- `metadata.json` and `fixture.json`: run settings and source, dependency lockfile, and input hashes.

`results/latest.txt` points to the latest completed run.
