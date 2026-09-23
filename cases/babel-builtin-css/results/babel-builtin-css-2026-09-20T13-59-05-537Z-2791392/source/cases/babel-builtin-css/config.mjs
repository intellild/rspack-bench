import { createConfig as baseConfig } from '../babel-loader-large-files/config.mjs';
export function createConfig(job, req, rspack, plugin) {
  const config = baseConfig({ ...job, parallel: true }, req.resolve('babel-loader'), plugin);
  config.output.uniqueName = 'babel-builtin-css-bench';
  config.output.cssFilename = 'main.css';
  config.experiments.css = true;
  config.module.rules.push({
    test: /\.module\.css$/,
    type: 'css/module',
    parser: { namedExports: true },
    generator: { localIdentName: 'scoped_[local]', exportsConvention: 'as-is', exportsOnly: false },
  });
  return config;
}
