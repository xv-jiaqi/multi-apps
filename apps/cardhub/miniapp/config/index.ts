import path from 'node:path';
import type { UserConfigExport } from '@tarojs/cli';

// Workspace packages (e.g. @repo/ui-mini) import `@tarojs/components` but the
// Taro platform plugins like `@tarojs/plugin-platform-weapp` are only installed
// under `apps/cardhub/miniapp/node_modules`. Webpack's default resolve walks
// only the requester's ancestor `node_modules`, which misses that path when the
// requester lives in `packages/ui-mini/`. Adding the miniapp's `node_modules`
// to `resolve.modules` lets webpack find the platform plugins no matter who
// triggered the import.
const miniappNodeModules = path.resolve(__dirname, '../node_modules');

const config: UserConfigExport<'webpack5'> = {
  projectName: 'cardhub-miniapp',
  date: '2026-4-21',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: `dist/${process.env.TARO_ENV}`,
  compiler: 'webpack5',
  cache: {
    enable: true,
  },
  plugins: [],
  framework: 'react',
  defineConstants: {
    TRPC_URL: JSON.stringify(process.env.TRPC_URL ?? 'http://localhost:4000/trpc'),
  },
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false },
    },
    webpackChain(chain) {
      chain.resolve.modules.add(miniappNodeModules).add('node_modules');
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    output: { filename: 'js/[name].[hash:8].js', chunkFilename: 'js/[name].[chunkhash:8].js' },
    miniCssExtractPluginOption: {
      ignoreOrder: true,
      filename: 'css/[name].[hash].css',
      chunkFilename: 'css/[name].[chunkhash].css',
    },
    postcss: {
      autoprefixer: { enable: true, config: {} },
      cssModules: { enable: false },
    },
    webpackChain(chain) {
      chain.resolve.modules.add(miniappNodeModules).add('node_modules');
    },
  },
  rn: {
    appName: 'cardhub',
    postcss: {
      cssModules: { enable: false },
    },
  },
};

export default config;
