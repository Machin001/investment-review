/**
 * 跨交易的模式发现
 *
 * 单笔复盘回答「这一次错在哪」，模式面板回答「我是不是一直在犯同一个错」。
 * 只做聚合，不做推断：所有数字来自各笔复盘会话的归因与偏差命中结果。
 */

import { listPositions } from './store';
import { buildReview } from './review';
import type { Gap } from './evidence';

export interface PatternBiasRow {
  code: string;
  label: string;
  /** 命中的交易笔数（按 entry.id 去重） */
  count: number;
  /** 纳入统计的交易总数，界面显示为 count / total */
  total: number;
  symbols: string[];
  rules: string[];
}

export interface PatternReport {
  totalPositions: number;
  closedPositions: number;
  winRate: number | null;
  avgReturnPct: number | null;
  /** 盈利单平均持有交易日 */
  avgWinHoldDays: number | null;
  /** 亏损单平均持有交易日 */
  avgLossHoldDays: number | null;
  /** 盈利单持有 / 亏损单持有，越小越接近「赚了就跑、亏了死扛」 */
  dispositionRatio: number | null;
  biasRows: PatternBiasRow[];
  perPosition: {
    id: string;
    name: string;
    thscode: string;
    returnPct: number | null;
    holdDays: number | null;
    biasLabels: string[];
  }[];
  gaps: Gap[];
  generatedAtMs: number;
}

let cache: { at: number; value: PatternReport } | null = null;
const TTL = 5 * 60_000;

export async function buildPatterns(force = false): Promise<PatternReport> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.value;

  const positions = await listPositions();
  const gaps: Gap[] = [];
  const rows: PatternReport['perPosition'] = [];
  const biasMap = new Map<string, PatternBiasRow & { hitIds: Set<string> }>();
  const winHolds: number[] = [];
  const lossHolds: number[] = [];
  const returns: number[] = [];

  for (const pos of positions) {
    try {
      const payload = await buildReview({
        entry: pos.entry,
        exit: pos.exit,
        hypothesis: pos.hypothesis,
        viewpoint: 'today',
      });

      const ret = payload.attribution?.totalReturnPct ?? null;
      const holdRaw = payload.attribution?.inputs['持有交易日']?.value;
      const hold = typeof holdRaw === 'number' ? holdRaw : null;

      if (ret !== null) {
        returns.push(ret);
        if (ret >= 0 && hold !== null) winHolds.push(hold);
        if (ret < 0 && hold !== null) lossHolds.push(hold);
      }

      for (const hit of payload.biasHits) {
        const row =
          biasMap.get(hit.code) ??
          ({
            code: hit.code,
            label: hit.label,
            count: 0,
            total: 0,
            symbols: [],
            rules: [],
            hitIds: new Set<string>(),
          } as PatternBiasRow & { hitIds: Set<string> });
        row.hitIds.add(pos.entry.id);
        if (!row.symbols.includes(pos.entry.name)) row.symbols.push(pos.entry.name);
        if (!row.rules.includes(hit.rule)) row.rules.push(hit.rule);
        biasMap.set(hit.code, row);
      }

      rows.push({
        id: pos.entry.id,
        name: pos.entry.name,
        thscode: pos.entry.thscode,
        returnPct: ret,
        holdDays: hold,
        biasLabels: payload.biasHits.map((h) => h.label),
      });

      for (const g of payload.gaps) {
        if (!gaps.some((x) => x.item === g.item)) gaps.push(g);
      }
    } catch (err) {
      gaps.push({
        item: `持仓 ${pos.entry.name}`,
        reason: (err as Error).message.slice(0, 160),
        impact: '该笔未纳入本期模式统计',
      });
    }
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgWin = avg(winHolds);
  const avgLoss = avg(lossHolds);
  const totalReviewed = rows.length;

  const biasRows: PatternBiasRow[] = [...biasMap.values()]
    .map((r) => ({
      code: r.code,
      label: r.label,
      count: r.hitIds.size,
      total: totalReviewed,
      symbols: r.symbols,
      rules: r.rules,
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const value: PatternReport = {
    totalPositions: positions.length,
    closedPositions: rows.filter((r) => r.returnPct !== null).length,
    winRate: returns.length ? returns.filter((r) => r >= 0).length / returns.length : null,
    avgReturnPct: avg(returns),
    avgWinHoldDays: avgWin,
    avgLossHoldDays: avgLoss,
    dispositionRatio: avgWin !== null && avgLoss !== null && avgLoss > 0 ? avgWin / avgLoss : null,
    biasRows,
    perPosition: rows,
    gaps,
    generatedAtMs: Date.now(),
  };

  cache = { at: Date.now(), value };
  return value;
}

/** 处置效应是否成立：需要两边都有样本，否则不下结论 */
export function dispositionVerdict(r: PatternReport): { verdict: 'hit' | 'clear' | 'insufficient'; text: string } {
  if (r.avgWinHoldDays === null || r.avgLossHoldDays === null || r.winRate === null) {
    return { verdict: 'insufficient', text: '盈利单或亏损单样本缺失，无法判断处置效应' };
  }
  const ratio = r.dispositionRatio!;
  if (ratio < 0.5) {
    return {
      verdict: 'hit',
      text: `盈利单平均持有 ${r.avgWinHoldDays.toFixed(1)} 个交易日，亏损单 ${r.avgLossHoldDays.toFixed(1)} 个，比值 ${ratio.toFixed(2)} —— 典型的"赚了就跑、亏了死扛"`,
    };
  }
  return {
    verdict: 'clear',
    text: `盈利单平均持有 ${r.avgWinHoldDays.toFixed(1)} 个交易日，亏损单 ${r.avgLossHoldDays.toFixed(1)} 个，比值 ${ratio.toFixed(2)}，未表现出该偏差`,
  };
}
