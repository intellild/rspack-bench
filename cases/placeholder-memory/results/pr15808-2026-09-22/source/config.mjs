import path from 'node:path';
export function configuration(job, rspack, deps) {
  const { scenario, fixture, output } = job;
  const native = scenario === 'css-native-sri',
    extract = scenario.startsWith('css-extract');
  const modern = scenario === 'modern-module',
    preserve = scenario === 'module-preserve';
  const runtime = scenario === 'runtime-template';
  const urls = runtime || scenario.startsWith('url-'),
    node = scenario === 'node-external',
    rstest = scenario === 'rstest';
  const kind = native
    ? 'native'
    : extract
      ? 'extract'
      : modern || preserve
        ? 'modern'
        : urls
          ? 'urls'
          : rstest
            ? 'rstest'
            : 'node';
  const esm = modern || preserve || rstest || scenario === 'url-worker';
  const c = {
    context: fixture,
    mode: 'production',
    devtool: false,
    cache: false,
    incremental: false,
    entry: `./${kind}/${modern || scenario === 'url-worker' ? 'with-workers' : 'index'}.js`,
    target: node || rstest ? 'node' : 'web',
    output: {
      path: output,
      filename: 'js/[name].js',
      chunkFilename: 'js/[name].js',
      cssFilename: 'css/[name].css',
      cssChunkFilename: 'css/[name].css',
      assetModuleFilename: 'assets/[name][ext]',
      publicPath: 'auto',
      clean: true,
      ...(esm
        ? {
            module: true,
            library: { type: modern ? 'modern-module' : 'module' },
          }
        : {}),
    },
    experiments: { css: native, outputModule: esm, newCache: false },
    optimization: {
      minimize: false,
      moduleIds: 'named',
      chunkIds: 'named',
      concatenateModules: modern,
      splitChunks: false,
      runtimeChunk: false,
    },
    module: {
      rules: [
        { test: /\.inline\.svg$/, type: 'asset/inline' },
        {
          test: /\.base\.svg$/,
          type: 'asset/resource',
          generator: { publicPath: '' },
        },
        {
          test: /\.keep\.svg$/,
          type: 'asset/resource',
          generator: { importMode: 'preserve' },
        },
        { test: /(?<!\.inline|\.base|\.keep)\.svg$/, type: 'asset/resource' },
      ],
    },
    plugins: [],
    performance: false,
  };
  if (runtime) {
    c.entry = Object.fromEntries(
      Array.from({ length: Math.min(16, job.modules) }, (_, i) => [
        `entry-${i}`,
        `./urls/batch-${i}.js`,
      ]),
    );
    c.optimization.runtimeChunk = {
      name: (entrypoint) => `runtime-${entrypoint.name}`,
    };
  }
  if (native)
    c.module.rules.push(
      {
        test: /\.module\.css$/,
        type: 'css/module',
        generator: { localIdentName: '[id]__[local]' },
      },
      {
        test: /text-\d+\.css$/,
        type: 'css/module',
        parser: { exportType: 'text' },
        generator: { localIdentName: '[name]__[local]' },
      },
    );
  if (extract) {
    c.module.rules.push({
      test: /\.css$/,
      type: 'javascript/auto',
      use: [
        {
          loader: rspack.CssExtractRspackPlugin.loader,
          options:
            scenario === 'css-extract-relative'
              ? { publicPath: '../cdn.v1/' }
              : {},
        },
        {
          loader: deps.resolve('css-loader'),
          options: { modules: { localIdentName: '[name]__[local]' } },
        },
      ],
    });
    c.plugins.push(
      new rspack.CssExtractRspackPlugin({
        filename: 'css/[name].css',
        chunkFilename: 'css/[name].css',
      }),
    );
  }
  if (scenario.endsWith('-sri')) {
    c.output.crossOriginLoading = 'anonymous';
    c.plugins.push(
      new rspack.SubresourceIntegrityPlugin({
        hashFuncNames: ['sha256', 'sha384'],
      }),
    );
  }
  if (urls || modern || preserve)
    c.module.parser = {
      javascript: {
        url:
          runtime || scenario === 'url-relative'
            ? 'relative'
            : 'new-url-relative',
        worker: { url: 'new-url-relative' },
      },
    };
  if (node)
    c.resolve = {
      alias: { './node:local': path.join(fixture, 'node/local.js') },
    };
  if (rstest)
    c.plugins.push(
      new rspack.experiments.RstestPlugin({
        injectModulePathName: true,
        hoistMockModule: true,
        importMetaPathName: true,
        manualMockRoot: path.join(fixture, '__mocks__'),
      }),
    );
  return c;
}
