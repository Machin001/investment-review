/**
 * 测试运行器
 *
 * 存在的唯一理由：把临时目录指到项目内再启动 Vitest。
 *
 * 某些受限环境（例如带文件系统钩子 / 禁止写系统 Temp 的沙箱）会让 Vitest 内部
 * 写 os.tmpdir() 时抛 EPERM，进而导致部分测试文件收集失败 —— 表现为
 * 「测试数量变少了」而不是报错，很容易被误判成测试通过。
 * 统一把 TEMP/TMP/TMPDIR 指向项目内 .tmp/ 后，收集稳定。
 *
 * 用法：node scripts/run-tests.mjs [vitest 参数...]
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tmp = path.join(root, '.tmp');
mkdirSync(tmp, { recursive: true });

const env = { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp };

// 透传 SMOKE=1 等环境变量；未显式指定时默认 run 模式
const passthrough = process.argv.slice(2);
const args = ['run', ...passthrough];

const child = spawn(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), ...args], {
  stdio: 'inherit',
  env,
  cwd: root,
});

child.on('exit', (code) => process.exit(code ?? 1));
