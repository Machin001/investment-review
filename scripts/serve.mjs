/**
 * 生产启动器
 *
 * 三个部署环境相关的问题都收敛在这里：
 *   1. 沙箱只注入 PORT，并要求监听 0.0.0.0 —— 不能用 `next start -p 3100` 这种写死端口的命令；
 *   2. 沙箱上传的是源码（node_modules 与 .next 被排除），没有构建产物时 next start 会直接报错；
 *   3. **重新发布时沙箱会被复用，旧的 .next 还在** —— 只判断「有没有构建产物」会导致
 *      新代码上传了却仍跑上一版构建（真实踩过：首页改了但线上没变）。
 *      因此必须比较源码与构建产物的时间戳。
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
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

/** 取目录下最新的修改时间（只看源码，不碰 node_modules） */
function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== '.next' && !e.name.startsWith('.')) walk(p);
        continue;
      }
      try {
        newest = Math.max(newest, statSync(p).mtimeMs);
      } catch {
        /* 忽略读不到的文件 */
      }
    }
  };
  walk(dir);
  return newest;
}

const buildIdPath = path.join(root, '.next', 'BUILD_ID');
let needBuild = !existsSync(buildIdPath);

if (!needBuild) {
  const builtAt = statSync(buildIdPath).mtimeMs;
  const srcAt = Math.max(
    newestMtime(path.join(root, 'src')),
    newestMtime(path.join(root, 'scripts')),
    statSync(path.join(root, 'package.json')).mtimeMs,
  );
  needBuild = srcAt > builtAt;
  if (needBuild) console.log('[serve] 源码比构建产物新，重新构建 …');
}

if (process.env.SKIP_BUILD === '1') {
  console.log('[serve] SKIP_BUILD=1，跳过构建检查');
} else if (needBuild) {
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
