# Rspack React / CSS Modules benchmark

Compares `@rspack/core@1.7.11`, `@rspack/core@2.2.3`, and the locally compiled Rspack using a shared fixture of 10,000 React components and 10,000 CSS Modules files. The packages under `versions/` declare separate Rspack versions in a pnpm workspace, with one root `pnpm-lock.yaml`.

Dependencies are pinned to `zx@8.8.5`, `less-loader@13.0.0`, `less@4.9.1`, `css-loader@7.1.5`, and `react@19.1.0`. Uses `pnpm@10.12.4`. Requires Node.js 22.12.0 or later.

## Run

```bash
pnpm install --frozen-lockfile
pnpm bench --modules 10000 --runs 5 --supplement always
```

| Option | Default | Description |
|---|---|---|
| `--versions` | `v1,v2,local` | Comma-separated version groups to run |
| `--modules` | `10000` | Number of React components; also generates one CSS Module per component |
| `--runs` | `5` | Measured builds per group |
| `--styles` | `less` | Input syntax: `less` or `css` |
| `--supplement` | `auto` | Additional comparisons: `auto`, `always`, or `never` |
| `--experiment` | `baseline` | Comparison suite: `baseline` or `mixed` |
| `--generate-only` | `false` | Generate the fixture without running builds |

`always` runs every comparison; `never` runs only the native and noop groups. `auto` selects additional comparisons based on the input syntax and measured results.

`pnpm generate` generates the default 10,000 components without running benchmarks. Use `pnpm generate --modules 100` to change the count.

`pnpm smoke`, `pnpm smoke:css`, and `pnpm smoke:mixed` check the Less, CSS, and mixed-loader paths using 24 components and one measured build per group.

## Local Rspack

`versions/local` links `@rspack/core` to `~/rstack/rspack/packages/rspack`. The relative link assumes this benchmark lives at `~/projects/rspack-bench`. It uses the existing JS build in `packages/rspack/dist/` and native binding in `crates/node_binding/`, with dependencies resolved from that Rspack checkout. Build the corresponding artifacts there before benchmarking source changes.

```bash
pnpm --filter rspack-bench-local bench
pnpm --filter rspack-bench-local smoke
pnpm --filter rspack-bench-local smoke:mixed
pnpm bench --versions v2,local --experiment mixed
```

The runner verifies that the local core and native binding are loaded from the checkout. Results record the compiled core version separately from `package.json`, plus local artifact paths and SHA-256 hashes. It rejects changes to those artifacts between builds in a session. `--versions v1,v2` selects only published releases.

## Fixture and comparisons

The entry imports every generated React component. Each `.jsx` component imports and uses exactly one `.module.less` file, or `.module.css` with `--styles css`. Components reference binary-tree children and their siblings, including mutual references. The `depth` prop bounds rendering of cyclic dependencies.

`builtin:swc-loader` compiles JSX with React's automatic runtime. Native CSS uses `css/module`; extraction enables CSS Modules in `css-loader`. Both use `scoped_[local]` identifiers, which are unique in this generated fixture. Each stylesheet produces a scoped class with three CSS rules and three declarations per rule. Less inputs use variables, a parametric mixin, nested selectors, and arithmetic. The fixture contains no `@import`, images, or fonts.

Each pipeline runs against every selected Rspack version:

| Group | Less pipeline | CSS pipeline |
|---|---|---|
| Native | less-loader → native CSS | Native CSS |
| Noop | less-loader → noop → native CSS | noop → native CSS |
| Extract | less-loader → css-loader → CssExtractRspackPlugin | css-loader → CssExtractRspackPlugin |

The extraction comparison also supports a layered entry with shared component dependencies: entry → sections → groups → React components → CSS Modules. Every run regenerates `cases/react-css/fixture/`.

`--experiment mixed` runs four groups per selected version: builtin Lightning CSS on/off × Less parallel on/off (twelve groups by default). It requires Less input and ignores `--supplement`.

```bash
pnpm bench --experiment mixed --modules 10000 --runs 5
```

The mixed pipeline executes `less-loader` → optional `builtin:lightningcss-loader` → `css-loader` → `CssExtractRspackPlugin`, using `javascript/auto` and `minify: false`. Only Less varies `parallel`; Rspack 1.x also enables `experiments.parallelLoader` for parallel groups. Worker count uses Rspack's default unless `RSPACK_LOADER_WORKER_THREADS` is set. Validation records actual Less execution threads and checks builtin loader identifiers in stats.

## Measurement

All builds use development mode with source maps, caching, incremental builds, and configurable optimizations disabled. Parallel loaders are disabled except in the mixed experiment's explicit parallel groups. Module and chunk IDs use `natural`. Each build runs in a fresh Node.js process and writes to a separate output directory. OS file caches remain intact.

Each group runs one correctness check, one warmup, and five measured builds by default. Measurements run serially with rotating group order. Correctness checks verify React and CSS module counts, loader and Less compilation counts, expanded CSS declarations, and output consistency. They also execute the emitted bundle, call every component, and check CSS Modules class bindings and component references. Per-module counters are enabled only during validation.

Build time covers `compiler.run()` through its callback. Hook intervals record make → finishMake, finishMake → seal, seal → afterSeal, and emit → afterEmit. Process lifetime is measured separately. Dependency installation, fixture generation, compiler setup/close, detailed stats generation, and bundle validation are excluded from build time.

## Results

Each run writes to `results/<session>/`:

- `report.md`: medians, ranges, version ratios, and the cost of adding noop.
- `summary.json` and `raw/`: aggregated metrics and individual build records, including effective configuration and loaded dependency versions.
- `stats/`, `output/`, and `logs/`: detailed stats, generated bundles, and worker logs.
- `metadata.json` and `fixture.json`: run settings and source, dependency lockfile, and input hashes.

`results/latest.txt` points to the latest completed run.
