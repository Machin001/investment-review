import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    // 缓存写到项目内，避免依赖系统临时目录（某些受限环境会拦截系统 Temp 写入）
    cache: { dir: 'node_modules/.vitest-cache' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
