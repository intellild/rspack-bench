import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createConfig as baseConfig } from '../noop-loader/config.mjs';

export function createConfig(rspack, job, timingPlugin, verifyName) {
  const config = baseConfig(null, { ...job, noop: false }, timingPlugin);
  config.target = 'node';
  config.output.filename = '[name].js';
  config.output.chunkFilename = '[name].js';
  config.output.uniqueName = 'split-chunks-name-bench';
  let name = 'shared';
  if (job.mode === 'callback') name = job.verify ? verifyName : () => 'shared';
  if (job.mode === 'worker') {
    name = rspack.workerFunction(fileURLToPath(new URL('./name.cjs', import.meta.url)), {
      name: 'shared', ...(job.verify ? { auditDir: path.join(job.output, 'worker-audit') } : {}),
    });
  }
  config.optimization.splitChunks = {
    name,
    chunks: 'all',
    minSize: 0,
    minChunks: 1,
    maxAsyncRequests: Infinity,
    maxInitialRequests: Infinity,
    cacheGroups: {
      default: false,
      defaultVendors: false,
      benchmark: { test: /module-\d+\.js$/, enforce: true, reuseExistingChunk: false },
    },
  };
  return config;
}
