import { runBenchmark } from '../../lib/loader-overhead/bench.mjs';

await runBenchmark('babel-loader', import.meta.url);
