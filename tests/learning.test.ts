import { describe, it, expect } from 'vitest';
import { buildLearningAssets } from '@/lib/review';
import { classifyHypothesisAnchor } from '@/lib/evidence';
import type { BiasHit, Trade } from '@/lib/types';
import { parseDateTime } from '@/lib/time';

const entry: Trade = {
  id: 'X1',
  thscode: '603986.SH',
  name: '兆易创新',
  side: 'buy',
  tradedAtMs: parseDateTime('2026-08-03 10:23'),
  price: 340.74,
  qty: 200,
  amount: 68148,
  fee: 20.44,
  positionId: 'P1',
  entrySource: 'seed',
  positionWeight: 0.28,
  sectorQuery: '电子->半导体->集成电路',
};

function hit(code: string, label: string): BiasHit {
  return {
    code,
    label,
    evidenceText: '测试证据',
    evidenceIds: [],
    rule: '测试规则',
    severity: 2,
    sampleSize: 3,
  };
}

describe('学习资产', () => {
  const hits = [hit('hot_rank_driven', '按市场热度而非自身逻辑建仓'), hit('early_exit_no_rule', '卖出缺少规则')];

  it('同一偏差产出的清单项与提醒卡 id 不冲突', () => {
    const assets = buildLearningAssets({ sessionId: 'S-X1', biasHits: hits, entry, attribution: null });
    const ids = assets.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    // hot_rank_driven 会同时产出 checklist_item 与 reminder_card
    expect(assets.filter((a) => a.id.includes('hot_rank_driven'))).toHaveLength(2);
  });

  it('三类资产都能产出，且每条都能回溯到来源会话', () => {
    const assets = buildLearningAssets({ sessionId: 'S-X1', biasHits: hits, entry, attribution: null });
    const kinds = new Set(assets.map((a) => a.kind));
    expect(kinds.has('checklist_item')).toBe(true);
    expect(kinds.has('reminder_card')).toBe(true);
    expect(kinds.has('error_dictionary')).toBe(true);
    expect(assets.every((a) => a.fromSessionId === 'S-X1')).toBe(true);
    expect(assets.every((a) => a.trigger.length > 0)).toBe(true);
  });

  it('没有命中偏差时不产出资产，但也不会报错', () => {
    const assets = buildLearningAssets({ sessionId: 'S-X1', biasHits: [], entry, attribution: null });
    expect(assets).toHaveLength(0);
  });

  it('赚钱 + 热度驱动 会额外产出一条「赚钱≠决策正确」的提醒', () => {
    const assets = buildLearningAssets({
      sessionId: 'S-X1',
      biasHits: [hit('hot_rank_driven', '热度驱动')],
      entry,
      attribution: {
        totalReturnPct: 13.05,
        marketPct: 6.28,
        sectorPct: 0.98,
        idiosyncraticPct: 0,
        executionPct: -0.07,
        unexplainedPct: 5.86,
        inputs: {},
        degraded: [],
      },
    });
    expect(assets.some((a) => a.id.includes('lucky_win'))).toBe(true);
  });
});

describe('假设可信锚边界', () => {
  const decisionAt = parseDateTime('2026-08-03 10:23');

  it('缓冲窗口内补写仍算 contemporaneous', () => {
    expect(
      classifyHypothesisAnchor({
        createdAtMs: decisionAt + 23 * 3600_000,
        decisionAtMs: decisionAt,
        crossChecked: false,
      }),
    ).toBe('contemporaneous');
  });

  it('超出缓冲一秒即降级', () => {
    expect(
      classifyHypothesisAnchor({
        createdAtMs: decisionAt + 24 * 3600_000 + 1000,
        decisionAtMs: decisionAt,
        crossChecked: false,
      }),
    ).toBe('recall_only');
  });
});
