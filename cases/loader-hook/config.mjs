import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const noopPath = fileURLToPath(new URL('../../loaders/noop.cjs', import.meta.url));

export function createConfig(rspack, job, timingPlugin, verifyHook) {
  const plugins = [timingPlugin];
  if (job.hook) plugins.push({
    apply(compiler) {
      compiler.hooks.compilation.tap('BenchmarkLoaderHook', compilation => {
        // The measured callback is deliberately empty. Validation counts calls
        // separately, without adding a loader hook to the no-hook control.
        rspack.NormalModule.getCompilationHooks(compilation).loader.tap(
          'BenchmarkLoaderHook', job.verify ? verifyHook : () => {},
        );
      });
    },
  });
  return {
    context: job.fixture,
    entry: './module-00000.js',
    mode: 'development',
    target: ['web', 'es2020'],
    devtool: false,
    cache: false,
    incremental: false,
    lazyCompilation: false,
    experiments: { newCache: false, pureFunctions: false },
    output: { path: job.output, filename: 'main.js', publicPath: '', pathinfo: false,
      library: { type: 'commonjs2' }, uniqueName: 'loader-hook-bench', clean: false },
    optimization: {
      minimize: false, minimizer: [], concatenateModules: false, splitChunks: false,
      runtimeChunk: false, moduleIds: 'natural', chunkIds: 'natural',
      usedExports: false, sideEffects: false, providedExports: false, innerGraph: false,
      mangleExports: false, inlineExports: false, removeEmptyChunks: false,
      mergeDuplicateChunks: false, realContentHash: false, avoidEntryIife: false,
      nodeEnv: false, emitOnErrors: false,
    },
    module: { rules: [{ test: /\.js$/, include: path.resolve(job.fixture),
      type: 'javascript/auto', use: [{ loader: noopPath, parallel: false }] }] },
    plugins,
    stats: 'none',
    infrastructureLogging: { level: 'error' },
  };
}
