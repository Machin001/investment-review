/**
 * 生产启动器
 *
 * 两个部署环境相关的问题都收敛在这里：
 *   1. 沙箱只注入 PORT，并要求监听 0.0.0.0 —— 不能用 `next start -p 3100` 这种写死端口的命令；
 *   2. 沙箱上传的是源码（node_modules 与 .next 会被排除），因此启动前若没有构建产物，
 *      要先跑一次 next build，否则 next start 会直接报 "Could not find a production build"。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const port = process.env.PORT || '3100';
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, ...args], { stdio: 'inherit', env: process.env, cwd: root });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`next ${args[0]} exited with ${code}`))));
  });
}

if (!existsSync(path.join(root, '.next', 'BUILD_ID'))) {
  console.log('[serve] 未发现构建产物，先执行 next build …');
  await run(['build']);
}

console.log(`[serve] 启动服务：0.0.0.0:${port}`);
const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '0.0.0.0'], {
  stdio: 'inherit',
  env: process.env,
  cwd: root,
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
child.on('exit', (code) => process.exit(code ?? 0));
