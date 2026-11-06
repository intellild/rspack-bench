# Handwritten glob matcher versus regex-automata

Recorded on 2026-11-06 using Linux x64 on an Intel Xeon Platinum 8336C, Node.js 24.20.0 and the pinned nightly Rust toolchain. Both builds used the same production `release` profile with `opt-level=3`, fat LTO, one codegen unit, `panic=abort`, and stripping. Both PRs were based on `7d74e8f6be83bb31073ffaf43e72816b55157df3`. [Handwritten matcher #16025](https://github.com/web-infra-dev/rspack/pull/16025) · [Regex-automata #16467](https://github.com/web-infra-dev/rspack/pull/16467)

| Metric | Handwritten matcher | Regex-automata | Change |
| --- | ---: | ---: | ---: |
| Stripped binding size | 51,207,312 B | 51,172,240 B | −35,072 B (−0.069%) |
| Glob context time, median | 54.80 ms | 8.12 ms | −85.2% |
| Full build time, median | 81.24 ms | 33.91 ms | −58.3% |
| `stat` calls in the audit | 13,190 | 772 | −94.1% |
| `readdir` calls in the audit | 258 | 258 | 0% |

Both bundles returned the same 232 keys and values. The DFA lets the walker skip entries such as `pages/draft-*.mjs` before calling `stat`. The timings include this pruning and the rest of the glob context build.

[Raw samples, filesystem counts and binary hashes](benchmark.json) · [Pinned commits and build configuration](build-config.json) · [Reproduction steps](../../README.md)
