/**
 * 真实数据联调（可选执行）
 *
 * 默认跳过，避免没有凭证的环境测试失败。需要凭证时：
 *   SMOKE=1 npx vitest run tests/live-data.smoke.test.ts
 *
 * 这个用例的价值：验证「扶摇 + iFinD 双源 → 证据归一化 → 时点防火墙」这条链路
 * 在真实数据上成立，而不只是在手工构造的对象上成立。
 */

import { describe, it, expect } from 'vitest';
import { fuyao, barToEvidence } from '@/lib/providers/fuyao';
import { searchNotices } from '@/lib/providers/ifind';
import { partitionByCutoff, guardNoFutureLeak } from '@/lib/timewall';
import { parseDateTime, dayStartMs } from '@/lib/time';
import type { Evidence } from '@/lib/types';

const hasCreds = Boolean(process.env.FUYAO_API_KEY);
const live = process.env.SMOKE === '1' && hasCreds;

describe.skipIf(!live)('真实数据联调', () => {
  // 锚点：2026-08-03 10:23 买入贵州茅台
  const decAt = parseDateTime('2026-08-03 10:23');
  const start = dayStartMs('2026-06-01');
  const end = dayStartMs('2026-10-01');

  it('扶摇：个股与指数日K可取得且字段完整', async () => {
    const [stockBars, indexBars] = await Promise.all([
      fuyao.getStockBars('600519.SH', start, end),
      fuyao.getIndexBars('000300.SH', start, end),
    ]);
    expect(stockBars.length).toBeGreaterThan(50);
    expect(indexBars.length).toBeGreaterThan(50);
    expect(stockBars[0].close).toBeGreaterThan(0);
    expect(indexBars[0].close).toBeGreaterThan(0);
  }, 60_000);

  it('扶摇：热榜与涨停统计可取得', async () => {
    const hot = await fuyao.getHotList('2026-08-03', 10);
    const stats = await fuyao.getLimitUpStats('2026-08-03');
    expect(Array.isArray(hot)).toBe(true);
    expect(stats.limitUpCount).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('iFinD：公告检索返回带日期的片段', async () => {
    const notices = await searchNotices('贵州茅台 半年度经营情况', {
      timeStart: '2026-07-01',
      timeEnd: '2026-09-30',
      size: 3,
      symbol: '600519.SH',
    });
    expect(notices.length).toBeGreaterThan(0);
    for (const n of notices) {
      expect(n.publishedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n.timePrecision).toBe('date');
      expect(n.level).toBe('B');
    }
  }, 90_000);

  it('全链路：混入真实公告后，事后信息无法进入当时视图', async () => {
    const stockBars = await fuyao.getStockBars('600519.SH', start, end);
    const evidences: Evidence[] = stockBars.map((b) =>
      barToEvidence(b, { thscode: '600519.SH', name: '贵州茅台', kind: 'price' }),
    );
    const notices = await searchNotices('贵州茅台 公告', {
      timeStart: '2026-07-01',
      timeEnd: '2026-09-30',
      size: 5,
      symbol: '600519.SH',
    });

    const p = partitionByCutoff([...evidences, ...notices], decAt);

    // 当时视图里不允许出现任何晚于决策时点的 K 线或公告
    for (const e of p.visible) {
      const t = e.publishedAtMs;
      if (t !== null) expect(t).toBeLessThanOrEqual(decAt);
    }
    expect(() => guardNoFutureLeak(p.visible, decAt)).not.toThrow();

    // 决策之后的 K 线必须落在 after 里
    expect(p.after.length).toBeGreaterThan(20);

    // 同日公告（日期精度）必须落在 uncertain，不能进当时视图
    const sameDay = notices.filter((n) => n.publishedDate === '2026-08-03');
    for (const n of sameDay) {
      expect(p.visible.find((v) => v.id === n.id)).toBeUndefined();
    }

    console.log(
      `[smoke] 证据总数=${evidences.length + notices.length} ` +
        `可见=${p.visible.length} 事后=${p.after.length} ` +
        `同日待定=${p.uncertain.length} 无时间=${p.unknownTime.length}`,
    );
  }, 90_000);
});
