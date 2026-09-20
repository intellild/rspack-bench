import { fileURLToPath } from 'node:url';
import { createConfig as baseConfig } from '../noop-loader/config.mjs';

export const modes = {
  main: [false, false, false],
  mixed: [false, true, false],
  parallel: [true, true, true],
};
export const loaderNames = ['left', 'middle', 'right'];
export const loaderPaths = loaderNames.map(name => fileURLToPath(new URL(`./loaders/${name}.cjs`, import.meta.url)));

export function createConfig(job, plugin) {
  const config = baseConfig(null, { ...job, noop: false }, plugin);
  if (job.version === 'v2-1-0') delete config.experiments.newCache;
  config.output.uniqueName = 'mixed-loader-chain-bench';
  config.module.rules[0].use = loaderPaths.map((loader, index) => ({
    loader, options: {}, parallel: modes[job.mode][index],
    ...(job.version === 'v2-1-0' ? {} : { cache: false }),
  }));
  return config;
}
