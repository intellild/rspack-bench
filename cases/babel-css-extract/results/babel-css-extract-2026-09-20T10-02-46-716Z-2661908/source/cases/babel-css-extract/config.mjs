import { createConfig as baseConfig } from '../babel-loader-large-files/config.mjs';
export function createConfig(job, req, rspack, plugin) {
  const config = baseConfig({ ...job, parallel: true }, req.resolve('babel-loader'), plugin);
  config.output.uniqueName = 'babel-css-extract-bench';
  config.module.rules.push({ test: /\.module\.css$/, type: 'javascript/auto', use: [
    { loader: rspack.CssExtractRspackPlugin.loader, parallel: false, cache: false },
    { loader: req.resolve('css-loader'), parallel: false, cache: false, options: {
      modules: { localIdentName: 'scoped_[local]', namedExport: true, exportLocalsConvention: 'as-is' },
      import: false, url: false, sourceMap: false, esModule: true,
    } },
  ] });
  config.plugins.push(new rspack.CssExtractRspackPlugin({ filename: 'main.css' }));
  return config;
}
