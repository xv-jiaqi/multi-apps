import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // @tarojs/components pulls in a runtime that needs Taro globals.
      '@tarojs/components': path.resolve(root, 'src/test-stubs/taro-components.ts'),
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
