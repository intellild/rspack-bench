# splitChunks.name callback benchmark

Compares Rspack 2.1.0, 2.2.3, and the compiled checkout at `/data00/home/jinzhixin/.codex/worktrees/a77f/rspack`, selected through separate pnpm workspace packages.

```bash
pnpm install --frozen-lockfile
pnpm bench:split-chunks-name --modules 10000 --runs 5
```

The case reuses the existing 10,000-module JS graph. One enforced cache group extracts every module into a chunk named `shared`. Each version compares `optimization.splitChunks.name: 'shared'` with a callback returning `'shared'`, producing identical output within that version. There are no loaders. Development mode, disabled caching/incremental builds, and disabled optimization flags are retained except for splitChunks, which is the subject of this case.

[config.mjs](config.mjs) places the function on `optimization.splitChunks.name`; the cache group inherits it. Validation checks every callback resource, arguments, invocation count, microtask turns, module count, the shared chunk's complete membership, and the emitted bundle's exported sum. Measured callbacks contain no counters or assertions.

Each supported group runs one validation, one warmup, and five measured builds, serially in fresh Node processes with rotating order. Build time covers `compiler.run()` through its callback. The seal interval includes splitChunks as well as other sealing work. Compiler setup/close, stats, output execution, fixture preparation, and hashing are excluded from build time.

The local worker variant uses `workerFunction('./name.cjs', { name: 'shared' })`. The modified a77f implementation dispatches naming calls directly from Rust to the native worker queue. Workers receive owned module/chunk snapshots and return the name. Validation records all 10,000 resources and checks that every call executes on a worker thread. Measured calls omit this audit. `RSPACK_LOADER_WORKER_THREADS` controls pool size; when unset, the implementation uses `os.cpus().length - 1` workers (at least one). Each fresh process starts a new pool, so process time includes startup and build time may overlap worker startup.

Older builds that throw the specific unprepared-workerFunction error are recorded as unsupported and excluded from timings. Other failures stop the run. Use a release native build for comparisons with published versions.

Generated results go to `results/split-chunks-name-<session>/`, with raw samples/configs, input hashes, worktree state and patch, actual core/native/worker artifact hashes, a source snapshot, and the worker capability result. `results/latest-split-chunks-name.txt` points to the latest completed run.

## Recorded results

[10,000-module run with native worker support](results/split-chunks-name-2026-09-11T14-29-44-848Z-15/README.md), comparing all seven groups with five measured builds each.

[Original 10,000-module run from September 11, 2026](results/split-chunks-name-2026-09-11T11-54-45-041Z-15/README.md), before splitChunks worker support was added. Includes the unsupported result and all ordinary-callback samples.

[Worker startup diagnosis](results/split-chunks-startup-diagnostic-2026-09-14/README.md): 10,000 modules, before the prewarming change, comparing cold workers with waiting for readiness before building.

[Import-time prewarming results](results/split-chunks-startup-prewarm-2026-09-14/README.md): 10,000 modules after moving worker creation to Rspack loading and waiting before native builds. Includes lifecycle timestamps and three diagnostic samples per group; build timings exclude some startup work and are not end-to-end process timings.
