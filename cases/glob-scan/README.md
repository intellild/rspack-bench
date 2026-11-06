# Glob scan with release bindings

Compares the handwritten glob matcher in Rspack PR #16025 against the regex-automata implementation in PR #16467. Both revisions build the same [project entry](project/index.js) on a generated tree of 128 package directories and 18,688 candidate files. The tree includes many draft pages that share a directory with the two allowed page names. The entry uses brace alternatives, two positive patterns, and two exclusions. The benchmark checks the keys and values of all 232 expected imports.

## Reproduce

Use Linux x64 and Node.js 22.12 or later. In each Rspack source checkout, install the pinned dependencies and use the Rust toolchain from that revision.

| Binding | Rspack revision |
| --- | --- |
| `handwritten.node` | `6385c5177b0b7cfc0eb790cd4a514b092bdc0e7f` |
| `regex-automata.node` | `29974fad70619b0fad124cc9478c65d53778b970` |

Build both revisions with the production release command. Copy the output for each revision to the corresponding filename above.

```sh
RUST_TARGET=x86_64-unknown-linux-gnu pnpm run build:binding:release
# Output at crates/node_binding/rspack.linux-x64-gnu.node
```

Build the JS wrapper with `pnpm run build:js` in a compatible Rspack checkout. Pass the same built `packages/rspack/dist/index.js` to both bindings.

```sh
taskset -c 8-11 node cases/glob-scan/bench.mjs \
  --core /path/to/rspack/packages/rspack/dist/index.js \
  /path/to/handwritten.node /path/to/regex-automata.node
```

Choose four available logical CPUs for `taskset`. The runner generates the fixture and writes bundles and `benchmark.json` under the repository's ignored `results/glob-scan-*` directory. Use `--warmups 0 --rounds 1` for a smoke run.

## Measurement

Each binding runs in a separate persistent Node worker with four Rayon threads and four Tokio worker threads. The runner first executes the generated bundle and checks every export. This audit counts filesystem calls below the fixture's `src/` directory during glob context construction. Timed runs use the native filesystem. Each run creates a fresh compiler in production mode with cache, source maps and minimization disabled. The defaults are six warmups per binding and 25 measured rounds with alternating order.

Glob context time spans the `ContextModuleFactory.afterResolve` callback to `compilation.succeedModule`. The raw samples also record the interval from `compilation.buildModule` to `compilation.succeedModule`. Full build time spans `compiler.run` and its callback.

[Recorded comparison from 2026-11-06](results/pr16467-2026-11-06/report.md)
