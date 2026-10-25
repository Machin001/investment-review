import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // 缓存写到项目内，避免依赖系统临时目录
  cacheDir: 'node_modules/.vitest-cache',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    // 文件级串行：受限环境下多进程同时写临时目录会偶发 EPERM，
    // 表现为「测试文件数量变少」而不是报错，串行可以彻底避免这种假绿
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
