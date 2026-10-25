import { describe, it, expect } from 'vitest';
import type { Evidence } from '@/lib/types';
import { detectConflicts, summarizeConflicts, classifyHypothesisAnchor, isHypothesisCountable } from '@/lib/evidence';
import { noticeId } from '@/lib/providers/ifind';

function ev(opts: {
  id: string;
  metricKey?: string;
  value?: number;
  date?: string;
  symbol?: string;
  endpoint?: string;
}): Evidence {
  return {
    id: opts.id,
    type: 'limit_up_stat',
    level: 'A',
    title: opts.id,
    summary: '',
    symbol: opts.symbol,
    publishedAtMs: Date.now(),
    publishedDate: opts.date ?? '2026-10-16',
    timePrecision: 'ms',
    source: { provider: 'fuyao', endpoint: opts.endpoint ?? 'test', fetchedAtMs: Date.now() },
    metric: opts.metricKey ? { key: opts.metricKey, value: opts.value ?? 0, unit: '家' } : undefined,
  };
}

describe('跨源冲突检测 · 真实场景夹具', () => {
  it('涨停池 0 家 vs 涨停统计 59 家 → 双方都保留并互指', () => {
    const pool = ev({ id: 'pool', metricKey: 'market.limit_up_count', value: 0, endpoint: 'GET .../limit-up-pool' });
    const stats = ev({ id: 'stats', metricKey: 'market.limit_up_count', value: 59, endpoint: 'GET .../limit-up-statistics' });

    const out = detectConflicts([pool, stats]);
    expect(out.find((e) => e.id === 'pool')!.conflictWith).toEqual(['stats']);
    expect(out.find((e) => e.id === 'stats')!.conflictWith).toEqual(['pool']);
  });

  it('数值一致时不标记冲突', () => {
    const a = ev({ id: 'a', metricKey: 'market.limit_up_count', value: 59 });
    const b = ev({ id: 'b', metricKey: 'market.limit_up_count', value: 59 });
    detectConflicts([a, b]);
    expect(a.conflictWith).toBeUndefined();
    expect(b.conflictWith).toBeUndefined();
  });

  it('不同日期或不同标的之间不误判', () => {
    const a = ev({ id: 'a', metricKey: 'k', value: 1, date: '2026-10-16' });
    const b = ev({ id: 'b', metricKey: 'k', value: 9, date: '2026-10-17' });
    const c = ev({ id: 'c', metricKey: 'k', value: 3, symbol: '600519.SH' });
    detectConflicts([a, b, c]);
    expect(a.conflictWith).toBeUndefined();
    expect(b.conflictWith).toBeUndefined();
    expect(c.conflictWith).toBeUndefined();
  });

  it('没有 metric 的证据不参与冲突比对（不靠正则猜数）', () => {
    const a = ev({ id: 'a' });
    const b = ev({ id: 'b' });
    detectConflicts([a, b]);
    expect(a.conflictWith).toBeUndefined();
  });

  it('冲突摘要带出每个来源与数值，供界面直接展示', () => {
    const pool = ev({ id: 'pool', metricKey: 'market.limit_up_count', value: 0, endpoint: 'limit-up-pool' });
    const stats = ev({ id: 'stats', metricKey: 'market.limit_up_count', value: 59, endpoint: 'limit-up-statistics' });
    const list = [pool, stats];
    detectConflicts(list);

    const summary = summarizeConflicts(list);
    expect(summary).toHaveLength(1);
    expect(summary[0].metricKey).toBe('market.limit_up_count');
    expect(summary[0].values.map((v) => v.value).sort()).toEqual([0, 59]);
    expect(summary[0].values.map((v) => v.source).sort()).toEqual(['limit-up-pool', 'limit-up-statistics']);
  });
});

describe('假设可信锚', () => {
  const decisionAt = Date.parse('2026-08-03T02:23:00Z'); // 东八区 10:23

  it('决策当日写下 → contemporaneous', () => {
    expect(
      classifyHypothesisAnchor({ createdAtMs: decisionAt + 3 * 3600_000, decisionAtMs: decisionAt, crossChecked: false }),
    ).toBe('contemporaneous');
  });

  it('三个月后补写但能与当时证据交叉印证 → evidence_backed', () => {
    expect(
      classifyHypothesisAnchor({ createdAtMs: decisionAt + 90 * 24 * 3600_000, decisionAtMs: decisionAt, crossChecked: true }),
    ).toBe('evidence_backed');
  });

  it('纯事后回忆 → recall_only，且不计入归因权重', () => {
    const anchor = classifyHypothesisAnchor({
      createdAtMs: decisionAt + 90 * 24 * 3600_000,
      decisionAtMs: decisionAt,
      crossChecked: false,
    });
    expect(anchor).toBe('recall_only');
    expect(isHypothesisCountable(anchor)).toBe(false);
  });

  it('只有 contemporaneous 与 evidence_backed 可计入权重', () => {
    expect(isHypothesisCountable('contemporaneous')).toBe(true);
    expect(isHypothesisCountable('evidence_backed')).toBe(true);
    expect(isHypothesisCountable('recall_only')).toBe(false);
  });
});

describe('公告 id 幂等性', () => {
  it('同日期同标题 → id 恒定，与检索顺序无关', () => {
    const a = noticeId('2026-08-15', '贵州茅台2026年半年度报告');
    const b = noticeId('2026-08-15', '贵州茅台2026年半年度报告');
    expect(a).toBe(b);
    expect(a.startsWith('ifind:notice:2026-08-15:')).toBe(true);
  });

  it('不同标题或不同日期 → id 不同', () => {
    expect(noticeId('2026-08-15', 'A')).not.toBe(noticeId('2026-08-15', 'B'));
    expect(noticeId('2026-08-15', 'A')).not.toBe(noticeId('2026-08-16', 'A'));
  });
});
