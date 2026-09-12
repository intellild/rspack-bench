import { createConfig as baseConfig } from '../noop-loader/config.mjs';

export const loaderCacheOptions = {
  module: false, codeGeneration: false, devtool: false, minimize: false, loader: true,
};

export function createConfig(job, loaderPath, plugin) {
  const config = baseConfig(null, { ...job, noop: false }, plugin);
  config.output.uniqueName = 'babel-loader-parallel-cache-bench';
  if (job.version === 'v2-1-0') {
    // 2.1.0 predates the new loader cache. Disable its legacy cache entirely.
    delete config.experiments.newCache;
    config.cache = false;
  } else {
    // Memory is only the storage backend. Every cache layer except loaders is off.
    config.cache = { type: 'memory' };
    config.experiments.newCache = { ...loaderCacheOptions };
  }
  const use = { loader: loaderPath, parallel: job.parallel, options: {
    babelrc: false, configFile: false, cacheDirectory: false, sourceMaps: false,
    presets: [], plugins: [], comments: false, compact: false, minified: false,
  } };
  if (job.version !== 'v2-1-0') use.cache = job.cache;
  config.module.rules[0].use = [use];
  return config;
}
