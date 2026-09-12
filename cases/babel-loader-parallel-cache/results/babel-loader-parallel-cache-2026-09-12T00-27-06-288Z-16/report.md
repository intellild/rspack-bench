# Babel loader parallel / cache benchmark

Development; all optimizations and incremental disabled. Babel disk/config caches off. Rspack 2.2.3/local use memory storage with only newCache.loader enabled; module/codeGeneration/devtool/minimize caches off. Rspack 2.1.0 legacy cache off; loader cache on unsupported. Parallel uses default worker count unless overridden in environment.

Each fresh process creates one compiler: cold build, then full rebuild with unchanged contents and all resources marked modified. Each measured pair starts with empty loader cache and a fresh worker pool. Serial processes; rotating group order; OS cache retained.

10000 modules; one validation pair, one warmup pair and 5 measured pairs per supported group. 136 builds in successful pairs; 2 failed pairs (not retried).

Milliseconds: median [min, max]. Cold starts with an empty loader cache. Warm rebuilds all modules and reuses the compiler, loader cache and worker pool.

| Version | parallel | use.cache | Cold build | Warm build | Cold make | Warm make | Pair process | Successful / attempted samples |
|---|---|---|---:|---:|---:|---:|---:|---:|
| v2-1-0 | off | off | 6363.28 [6207.00, 6454.19] | 5153.13 [5061.90, 5492.26] | 6141.64 [5989.93, 6238.85] | 4865.35 [4783.29, 5201.30] | 14312.20 [14117.19, 14757.02] | 5 / 5 |
| v2-1-0 | off | on | unsupported | unsupported | — | — | — | — |
| v2-1-0 | on | off | 5109.39 [4918.64, 5213.76] | 3722.05 [3644.31, 3928.77] | 4908.70 [4704.56, 5008.92] | 3442.77 [3375.83, 3646.51] | 12099.53 [11910.38, 12611.81] | 5 / 5 |
| v2-1-0 | on | on | unsupported | unsupported | — | — | — | — |
| v2 | off | off | 6799.62 [6540.38, 7019.43] | 5159.90 [4801.57, 5244.46] | 6597.11 [6309.73, 6819.34] | 5001.85 [4658.34, 5100.28] | 15087.90 [14542.34, 15382.67] | 5 / 5 |
| v2 | off | on | 6490.02 [6379.31, 6623.14] | 1108.92 [1082.36, 1239.00] | 6202.77 [6069.91, 6411.50] | 948.80 [925.51, 1093.31] | 10600.02 [10376.78, 10821.82] | 5 / 5 |
| v2 | on | off | 5570.35 [5465.63, 5649.93] | 3635.68 [3590.45, 3717.03] | 5369.79 [5262.21, 5439.11] | 3490.28 [3435.07, 3563.22] | 12746.41 [12654.46, 12939.38] | 5 / 5 |
| v2 | on | on | 6845.59 [6757.41, 7049.32] | 3827.36 [3821.79, 3910.60] | 6637.31 [6557.93, 6852.35] | 3685.43 [3678.43, 3772.65] | 14199.99 [14020.48, 14386.69] | 5 / 5 |
| worktree-a77f | off | off | 7000.30 [6841.40, 7183.03] | 5316.59 [5261.69, 5398.65] | 6786.98 [6625.91, 6958.35] | 5171.24 [5112.42, 5246.48] | 15533.49 [15372.07, 15565.34] | 5 / 5 |
| worktree-a77f | off | on | 6584.63 [6464.30, 6738.09] | 1353.28 [1256.18, 1449.30] | 6363.29 [6223.90, 6489.46] | 1203.50 [1106.61, 1293.06] | 10988.67 [10776.17, 11285.09] | 5 / 5 |
| worktree-a77f | on | off | 4296.07 [4287.44, 4385.41] | 2312.21 [2270.44, 2357.25] | 4012.15 [3976.52, 4083.38] | 2154.91 [2099.06, 2191.91] | 10315.66 [10271.85, 10491.34] | 5 / 5 |
| worktree-a77f | on | on | 4532.24 [4517.22, 4680.57] | 1892.34 [1886.39, 1957.18] | 4220.71 [4144.88, 4288.71] | 1731.56 [1725.52, 1789.68] | 10016.67 [9953.97, 10144.87] | 3 / 5 |

Failed pairs are excluded from timing distributions and retained in failures.json/raw records. No automatic retries were performed. Successful-sample medians are conditional on completion; consult failure counts alongside timings.

- worktree-a77f-parallel-on-cache-on-measure-3:   × Module build failed (from ../../../node_modules/.pnpm/babel-loader@10.1.1_@babel+core@7.29.7_@rspack+core@..+.codex+worktrees+a77f+rspack+packages+rspack/node_modules/babel-loader/lib/index.js):
  ╰─▶   × Error: The original reference that WeakReference<rspack_binding_api::compilation::JsCompilation> is pointing to is dropped
        │     at file:///data00/home/jinzhixin/.codex/worktrees/a77f/rspack/packages/rspack/dist/worker.js:3902:69
        │     at runWorkerLoop (file:///data00/home/jinzhixin/.codex/worktrees/a77f/rspack/packages/rspack/dist/worker.js:3906:18)


- worktree-a77f-parallel-on-cache-on-measure-4:   × Module build failed (from ../../../node_modules/.pnpm/babel-loader@10.1.1_@babel+core@7.29.7_@rspack+core@..+.codex+worktrees+a77f+rspack+packages+rspack/node_modules/babel-loader/lib/index.js):
  ╰─▶   × Error: The original reference that WeakReference<rspack_binding_api::compilation::JsCompilation> is pointing to is dropped
        │     at file:///data00/home/jinzhixin/.codex/worktrees/a77f/rspack/packages/rspack/dist/worker.js:3902:69
        │     at runWorkerLoop (file:///data00/home/jinzhixin/.codex/worktrees/a77f/rspack/packages/rspack/dist/worker.js:3906:18)



| Validation group | Cold Babel calls | Warm Babel calls | Cold / warm rebuilt modules | Worker threads observed |
|---|---:|---:|---:|---|
| v2-1-0-parallel-off-cache-off | 10000 | 10000 | 10000 / 10000 | 0 |
| v2-1-0-parallel-on-cache-off | 10000 | 10000 | 10000 / 10000 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31 |
| v2-parallel-off-cache-off | 10000 | 10000 | 10000 / 10000 | 0 |
| v2-parallel-off-cache-on | 10000 | 0 | 10000 / 10000 | 0 |
| v2-parallel-on-cache-off | 10000 | 10000 | 10000 / 10000 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31 |
| v2-parallel-on-cache-on | 10000 | 0 | 10000 / 10000 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31 |
| worktree-a77f-parallel-off-cache-off | 10000 | 10000 | 10000 / 10000 | 0 |
| worktree-a77f-parallel-off-cache-on | 10000 | 0 | 10000 / 10000 | 0 |
| worktree-a77f-parallel-on-cache-off | 10000 | 10000 | 10000 / 10000 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31 |
| worktree-a77f-parallel-on-cache-on | 10000 | 0 | 10000 / 10000 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31 |

Timing: compiler.run invocation to callback; setup/close, stats, audits, bundle evaluation and hashing excluded. Process timing covers the entire two-build child process.

Only validation processes preload invocation counters. Measured builds contain no loader/Babel counters or buildModule taps. All builds check 10,000 freshly built modules, the exact Babel loader chain, output hashes and the exported sum. Outputs match across settings and repetitions within each version. Loader cache hits are confirmed by zero loader and Babel calls on the warm validation build while all modules still rebuild.

The memory backend is required by the new loader cache; it does not enable the disabled module, code-generation, devtool or minimizer layers. Rspack 2.1.0 has neither experiments.newCache nor use.cache, so its cache-on combinations have no timings. Babel cacheDirectory, babelrc and configFile are false in every group.

Each cache-on/off comparison within 2.2.3 or local changes only use.cache. The 2.1.0 cache-off groups use cache:false because that version has only the legacy cache. Default worker counts and fresh pool startup are included as described above. Repeated rebuilds also benefit from worker/JIT/OS warmup, so cold-to-warm differences alone do not isolate cache savings: compare cache on versus off within the same state and parallel setting.

Raw records: raw/. Full stats: stats/. Validation invocation logs: audit/. Source snapshots: source/. Worktree patch: worktree.patch. Fixture hashes: fixture.json. Timings are descriptive, not significance tests; background activity and OS cache state are uncontrolled.
