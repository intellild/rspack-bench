import { createConfig as baseConfig } from '../noop-loader/config.mjs';

export function createConfig(job, loaderPath, plugin) {
  const config = baseConfig(null, { ...job, noop: false }, plugin);
  config.output.filename = 'main.cjs';
  config.output.uniqueName = 'babel-loader-large-files-bench';
  config.module.rules[0].use = [{ loader: loaderPath, parallel: job.parallel, cache: false, options: {
    babelrc: false, configFile: false, cacheDirectory: false, sourceMaps: false,
    presets: [], plugins: [], comments: false, compact: false, minified: false,
  } }];
  return config;
}
