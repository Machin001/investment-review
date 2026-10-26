import { describe, it, expect } from 'vitest';
import { computeAttribution } from '@/lib/attribution';
import { guardNoFutureLeak, TimeWallViolation } from '@/lib/timewall';
import type { DailyBar } from '@/lib/providers/types';
import type { Evidence } from '@/lib/types';
import { dayStartMs, dayCloseMs, shanghaiDate } from '@/lib/time';

/** 造一串连续交易日的 K 线，close 按给定斜率变化 */
function bars(from: string, n: number, start: number, slope: number): DailyBar[] {
  const out: DailyBar[] = [];
  for (let i = 0; i < n; i++) {
    const ms = dayStartMs(from) + i * 86_400_000;
    const close = start * (1 + slope * i);
    out.push({ dateMs: ms, open: close * 0.995, high: close * 1.01, low: close * 0.99, close, volume: 1e6, turnover: 1e8 });
  }
  return out;
}

const STOCK = '600519.SH';
const INDEX = '000300.SH';
const entryMs = dayStartMs('2026-08-03') + 10 * 3600_000;
const exitMs = dayStartMs('2026-08-20') + 14 * 3600_000;

const stockBars = bars('2026-05-01', 120, 100, 0.001);
const indexBars = bars('2026-05-01', 120, 4000, 0.0005);

function priceEvidence(kind: 'price' | 'index', code: string, date: string): Evidence {
  return {
    id: `${kind}:${code}:${date}`,
    type: kind,
    level: 'A',
    title: `${kind} ${code} ${date}`,
    summary: '',
    publishedAtMs: dayCloseMs(date),
    publishedDate: date,
    timePrecision: 'ms',
    source: { provider: 'fuyao', endpoint: 'test', fetchedAtMs: Date.now() },
  };
}

function ctx(over: Partial<Parameters<typeof computeAttribution>[0]> = {}) {
  return {
    evidences: [
      priceEvidence('price', STOCK, '2026-08-03'),
      priceEvidence('price', STOCK, '2026-08-20'),
      priceEvidence('index', INDEX, '2026-08-03'),
      priceEvidence('index', INDEX, '2026-08-20'),
    ],
    cutoffMs: dayCloseMs('2026-08-20'),
    entryPrice: 100,
    entryMs,
    exitPrice: 105,
    exitMs,
    entryFee: 5,
    exitFee: 5,
    entryQty: 100,
    stockBars,
    indexBars,
    sector: { value: null, evidenceId: null },
    calendar: [],
    stockCode: STOCK,
    indexCode: INDEX,
    ...over,
  };
}

describe('归因溯源链', () => {
  it('每个价格类归因项都挂上真实可点开的证据 id', () => {
    const { attribution } = computeAttribution(ctx());

    expect(attribution.inputs['建仓价'].sourceEvidenceIds).toEqual([`price:${STOCK}:2026-08-03`]);
    expect(attribution.inputs['卖出价'].sourceEvidenceIds).toEqual([`price:${STOCK}:2026-08-20`]);
    expect(attribution.inputs['实际收益'].sourceEvidenceIds).toEqual([
      `price:${STOCK}:2026-08-03`,
      `price:${STOCK}:2026-08-20`,
    ]);
  });

  it('基准指数收益引用带日期的指数证据，而不是裸 `index:代码`', () => {
    const { attribution } = computeAttribution(ctx());
    const ids = attribution.inputs['基准指数收益'].sourceEvidenceIds;
    expect(ids).toEqual([`index:${INDEX}:2026-08-03`, `index:${INDEX}:2026-08-20`]);
    for (const id of ids) expect(id.split(':').length).toBe(3);
  });

  it('β 引用回归窗口的首尾实际 K 线，不再为空数组', () => {
    const { attribution } = computeAttribution(ctx());
    const ids = attribution.inputs['β'].sourceEvidenceIds;
    expect(ids.length).toBe(2);
    for (const id of ids) {
      expect(id.startsWith(`price:${STOCK}:`)).toBe(true);
      // 回归窗口必须全部早于建仓日
      expect(id.split(':')[2] < '2026-08-03').toBe(true);
    }
  });

  it('证据 id 与时间线里的 K 线证据 id 格式一致（能真的对上）', () => {
    const { attribution } = computeAttribution(ctx());
    const timelineIds = new Set(
      stockBars.map((b) => `price:${STOCK}:${shanghaiDate(b.dateMs)}`),
    );
    for (const id of attribution.inputs['β'].sourceEvidenceIds) {
      expect(timelineIds.has(id)).toBe(true);
    }
  });
});

describe('归因入口护栏语义', () => {
  it('卖出之后才公开的证据不允许进入归因', () => {
    const after: Evidence = {
      id: 'notice-after',
      type: 'notice',
      level: 'B',
      title: '卖出后才发布的公告',
      summary: '',
      publishedAtMs: dayCloseMs('2026-09-01'),
      publishedDate: '2026-09-01',
      timePrecision: 'ms',
      source: { provider: 'ifind', endpoint: 'test', fetchedAtMs: Date.now() },
    };
    expect(() => computeAttribution(ctx({ evidences: [...ctx().evidences, after] }))).toThrow(TimeWallViolation);
  });

  it('卖出时点及之前的证据可以通过', () => {
    expect(() => guardNoFutureLeak(ctx().evidences, dayCloseMs('2026-08-20'))).not.toThrow();
  });
});

describe('归因五项闭合', () => {
  it('市场 + 行业 + 执行 + 残差 = 总收益', () => {
    const { attribution } = computeAttribution(ctx({ sector: { value: 3.2, evidenceId: 'ifind:sector:x' } }));
    const sum =
      attribution.marketPct +
      attribution.sectorPct +
      attribution.idiosyncraticPct +
      attribution.executionPct +
      attribution.unexplainedPct;
    expect(Math.abs(sum - attribution.totalReturnPct)).toBeLessThan(0.001);
  });
});
