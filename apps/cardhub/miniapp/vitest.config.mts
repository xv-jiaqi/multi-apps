import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // @tarojs/components pulls in a runtime that needs Taro globals.
      '@tarojs/components': path.resolve(root, 'src/test-stubs/taro-components.ts'),
      // @tarojs/taro pulls in @tarojs/runtime, which needs build-time globals.
      '@tarojs/taro': path.resolve(root, 'src/test-stubs/taro.ts'),
      // Source, not the CommonJS dist: require() in dist skips the aliases above
      // and would load the real Taro runtime.
      '@repo/ui-mini': path.resolve(root, '../../../packages/ui-mini/src/index.ts'),
    },
  },
  test: {
    server: {
      deps: {
        inline: [/packages\/ui-mini/],
      },
    },
  },
});
