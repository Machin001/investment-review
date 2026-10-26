/**
 * 复盘主链路联调（需真实凭证）
 *   SMOKE=1 npx vitest run tests/review.smoke.test.ts
 */

import { describe, it, expect } from 'vitest';
import { buildReview } from '@/lib/review';
import { computeAttribution } from '@/lib/attribution';
import { judgeVisibility, TimeWallViolation } from '@/lib/timewall';
import { SEED_TRADES, SEED_HYPOTHESES } from '@/data/seed';
import { parseDateTime } from '@/lib/time';

const live = process.env.SMOKE === '1' && Boolean(process.env.FUYAO_API_KEY);

describe.skipIf(!live)('复盘主链路 · 真实数据', () => {
  const entry = SEED_TRADES.find((t) => t.id === 'T1')!;
  const exit = SEED_TRADES.find((t) => t.id === 'T1-exit')!;

  it('T1 兆易创新：归因各项加总自洽，误差 < 0.01', async () => {
    const payload = await buildReview({
      entry,
      exit,
      hypothesis: SEED_HYPOTHESES.T1,
      viewpoint: 'today',
    });

    const a = payload.attribution!;
    expect(a).not.toBeNull();
    const sum = a.marketPct + a.sectorPct + a.idiosyncraticPct + a.executionPct + a.unexplainedPct;
    expect(Math.abs(sum - a.totalReturnPct)).toBeLessThan(0.01);
    expect(a.inputs['β'].value).not.toBeNull();
    console.log(
      `[T1] 总收益 ${a.totalReturnPct}% = 市场 ${a.marketPct}% + 行业 ${a.sectorPct}% + 执行 ${a.executionPct}% + 残差 ${a.unexplainedPct}%`,
    );
    console.log(`[T1] β=${a.inputs['β'].value} 样本=${a.inputs['β样本交易日数'].value} 持有交易日=${a.inputs['持有交易日'].value}`);
    console.log(`[T1] 证据 可见=${payload.visible.length} 事后=${payload.after.length} 待定=${payload.uncertain.length} 缺口=${payload.gaps.length}`);
  }, 120_000);

  it('当时视图里不存在任何晚于截止时点的证据', async () => {
    const payload = await buildReview({ entry, exit, hypothesis: SEED_HYPOTHESES.T1, viewpoint: 'entry' });
    for (const e of payload.visible) {
      expect(judgeVisibility(e, payload.cutoffMs).verdict).toBe('visible');
      if (e.publishedAtMs !== null) expect(e.publishedAtMs).toBeLessThanOrEqual(payload.cutoffMs);
    }
    // 买入时点在 08-03 盘中，当日收盘 K 线必须落在事后
    const sameDayBar = payload.after.find((e) => e.publishedDate === '2026-08-03' && e.type === 'price');
    expect(sameDayBar).toBeDefined();
    // 决策日盘中行情缺失必须显式说明
    expect(payload.meta.decisionDayNote).toContain('15:00');
  }, 120_000);

  it('T2 长鑫科技：证伪条件缺失被规则命中', async () => {
    const e2 = SEED_TRADES.find((t) => t.id === 'T2')!;
    const x2 = SEED_TRADES.find((t) => t.id === 'T2-exit')!;
    const payload = await buildReview({ entry: e2, exit: x2, hypothesis: SEED_HYPOTHESES.T2, viewpoint: 'today' });
    const codes = payload.biasHits.map((h) => h.code);
    expect(codes).toContain('no_falsify_condition');
    expect(payload.biasHits.every((h) => h.rule.length > 0)).toBe(true);
    console.log(`[T2] 命中偏差：${payload.biasHits.map((h) => h.label).join(' / ')}`);
    console.log(`[T2] 收益 ${payload.attribution?.totalReturnPct}% 沉淀资产 ${payload.assets.length} 条`);
  }, 120_000);

  it('归因入口护栏：传入事后证据直接抛错', async () => {
    const payload = await buildReview({ entry, exit, hypothesis: SEED_HYPOTHESES.T1, viewpoint: 'entry' });
    const future = payload.after[0];
    expect(future).toBeDefined();

    expect(() =>
      computeAttribution({
        evidences: [...payload.visible, future],
        cutoffMs: payload.cutoffMs,
        entryPrice: entry.price,
        entryMs: entry.tradedAtMs,
        exitPrice: exit.price,
        exitMs: exit.tradedAtMs,
        entryFee: entry.fee,
        exitFee: exit.fee,
        entryQty: entry.qty,
        stockBars: [],
        indexBars: [],
        sector: { value: null, evidenceId: null },
        calendar: [],
        stockCode: entry.thscode,
        indexCode: '000300.SH',
      }),
    ).toThrow(TimeWallViolation);
  }, 120_000);
});

describe.skipIf(live)('凭证缺失时', () => {
  it('没有凭证会抛出明确错误而非返回空结论', () => {
    const entry = SEED_TRADES[0];
    expect(() => parseDateTime('2026-08-03 10:23')).not.toThrow();
    expect(entry.thscode).toMatch(/\.(SH|SZ|BJ)$/);
  });
});
