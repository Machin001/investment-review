import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const STORE = path.join(process.cwd(), 'data', 'runtime', 'store.json');

/**
 * 冷启动并发回归测试（对应评审 R3-P0）
 *
 * 场景：store.json 不存在时，首页 Promise.all 会并发触发多个读-改-写，
 * 旧实现下多个 writeStore 竞争同一文件句柄，Windows 上抛 EPERM，页面直接 500。
 */
describe('store 冷启动并发', () => {
  beforeEach(async () => {
    await fs.rm(STORE, { force: true });
  });

  it('冷启动时并发读取不会抛错，且种子只初始化一次', async () => {
    // 动态导入：确保每个用例拿到干净的模块状态
    const mod = await import('@/lib/store');
    const [a, b, c] = await Promise.all([mod.listPositions(), mod.listAssets(), mod.listDecisions()]);
    expect(a.length).toBeGreaterThan(0);
    expect(Array.isArray(b)).toBe(true);
    expect(c.length).toBeGreaterThan(0);

    // 落盘成功且内容合法：listPositions 只返回建仓（buy），文档里还应有配对的卖出记录
    const raw = JSON.parse(await fs.readFile(STORE, 'utf8'));
    expect(raw.trades.filter((t: { side: string }) => t.side === 'buy').length).toBe(a.length);
    expect(raw.trades.length).toBeGreaterThan(a.length);
    expect(raw.decisions.length).toBeGreaterThan(0);
    expect(Array.isArray(raw.snapshots)).toBe(true);
  });

  it('并发写入不会互相覆盖：多次 addTrades 结果全部保留', async () => {
    const mod = await import('@/lib/store');
    const base = await mod.listPositions();
    const make = (n: number) => ({
      id: `race-${n}`,
      thscode: '600000.SH',
      name: `并发${n}`,
      side: 'buy' as const,
      tradedAtMs: Date.now(),
      price: 10,
      qty: 100,
      amount: 1000,
      fee: 1,
      positionId: `RP-${n}`,
      entrySource: 'form' as const,
    });

    await Promise.all([1, 2, 3, 4, 5].map((n) => mod.addTrades([make(n)])));

    const after = await mod.listPositions();
    const ids = after.map((x) => x.entry.id);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(ids).toContain(`race-${n}`);
    }
    expect(after.length).toBe(base.length + 5);
  });
});
