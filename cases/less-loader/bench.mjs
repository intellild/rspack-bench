import { runBenchmark } from '../../lib/loader-overhead/bench.mjs';

await runBenchmark('less-loader', import.meta.url);
