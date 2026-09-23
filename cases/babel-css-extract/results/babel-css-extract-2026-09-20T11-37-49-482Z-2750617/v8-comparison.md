# V8 native byte storage experiment

The experiment passed correctness checks but showed no whole-build speedup in this workload. In the current run the V8 branch took 6.67% longer for setup + cold build and 2.56% longer for full rebuild than 2.2.6. Compared with the previous branch run, medians rose 1.72% and 1.20%; the baseline also changed between runs, so these are not isolated measurements of the serialization change.

Existing work was committed before this experiment: Rspack `b4222b41b7`; benchmark `4b94946`. The current run uses that source plus the recorded patch.

Only loader options and additionalData change transport. Main uses node:v8.serialize; Rust owns the bytes. Workers call the binding directly and deserialize locally. Compiler/compilation RPC and the per-task main preparation path remain as before.

```text
service.ts::registerParallelLoader
  V8 serialize options at registration
       ↓
bridge.rs::LoaderReferences
  compiler / ident → owned Rust Vec<u8>
       ↓
worker references.get
  binding.getSerializedLoaderOptions → V8 deserialize → worker cache

loader additionalData
  V8 serialize in producing thread
       ↓
result.rs::SerializedLoaderData
  owned Vec<u8> in native LoaderContext → queue / builtin loader
       ↓
consumer task.takeContext
  Buffer created in consumer env → V8 deserialize
```

## Performance

Medians in seconds; the before-V8 result is a previous run, not a third group interleaved in this run. Each run independently compares both versions with five measured cold/full-rebuild pairs.

| Metric | Previous 2.2.6 | Previous branch | Current 2.2.6 | V8 branch | Current branch vs 2.2.6 |
|---|---:|---:|---:|---:|---:|
| Setup + cold | 99.885 | 101.957 | 97.229 | 103.715 | +6.67% |
| Full rebuild | 99.335 | 99.632 | 98.310 | 100.826 | +2.56% |

| Metric | V8 branch vs previous branch | Current baseline vs previous baseline |
|---|---:|---:|
| Setup + cold | +1.72% | -2.66% |
| Full rebuild | +1.20% | -1.03% |

These historical deltas include machine/run variation. They cannot identify serialization alone as their cause. The contemporaneous 2.2.6 comparison and sample ranges are the stronger measurements. See [report.md](report.md) and [analysis.md](analysis.md).

## Scope and verification

- All 74 loader-parallel / importModule integration cases passed, including the new serialized-data case in both normal and runtime modes. The test covers main → worker → builtin → worker → main, cycles, shared references, Buffer, typed arrays, Map, Set, Date, RegExp and BigInt. An options getter throws during make, so a worker fallback to main options reads fails the test.
- Rust check and clippy with -D warnings passed; native release and JS declarations built; JS lint/format and Rust formatting passed. Tests used a separate development artifact with test-loader; timing used the final release artifact.
- Both versions passed the 24 JS + 24 CSS diagnostic check and every build in the full comparison. JS and CSS output hashes match across versions and repetitions.
- The benchmark exercises options fetching. Babel is last in its normal JS chain, and unused additionalData is not returned to Rust. This workload does not measure large additionalData transfer performance.
- Options remain cached per worker and reference version; the previous bridge also cached options. Expecting a whole-build improvement proportional to removing an RPC from every module would be incorrect.
- Serialization snapshots values. Plain object graph identity is preserved within each decoded graph, not across isolates. Functions/nonserializable values and class-instance additionalData roots retain the existing bridge. Arbitrary custom prototypes/accessors are outside the experiment. Rust owns bytes, not V8/N-API values, and byte buffers are copied at the binding boundaries.
- The complete task queue / body / main prepare / native context / merge logs are preserved in audit.tar.gz. Concurrent latency sums are not CPU time. Main prepare still includes an RPC per worker task.

[Previous run](../babel-css-extract-2026-09-20T10-02-46-716Z-2661908/README.md).


## Diagnostic overhead before / after

Milliseconds, p50 / p95; instrumented historical runs, excluded from formal wall-time samples.

| Babel task metric | Previous cold | V8 cold | Previous rebuild | V8 rebuild |
|---|---:|---:|---:|---:|
| Outside queue and loader body | 1.804 / 35.038 | 1.730 / 34.372 | 1.749 / 34.421 | 1.707 / 32.580 |
| Main preparation interval | 0.596 / 1.793 | 0.599 / 1.745 | 0.562 / 1.788 | 0.543 / 1.647 |
| Native context construction | 0.015 / 0.021 | 0.015 / 0.020 | 0.015 / 0.021 | 0.015 / 0.020 |
| Native result merge | 0.014 / 0.020 | 0.014 / 0.021 | 0.015 / 0.021 | 0.015 / 0.022 |

These task intervals include event-loop contention and scheduling waits. Options are cached, and the main prepare RPC remains; these figures are not a direct timer of V8 serialize/deserialize.
