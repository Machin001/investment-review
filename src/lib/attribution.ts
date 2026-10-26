/**
 * 归因计算
 *
 * 硬约束（P1-2）：入口第一行必须过时点防火墙护栏。
 * 归因只能使用「当时可见」的证据，否则事后信息会从计算层绕过 UI 护栏混进来。
 *
 * 分解口径：
 *   个股区间收益 = 市场β贡献 + 行业超额贡献 + 执行偏差 + 残差
 *
 *   市场β贡献   β × 基准指数同期收益，β 用建仓前 60 个交易日日收益回归得到
 *   行业超额    板块区间收益 − 基准指数同期收益
 *   执行偏差    实际成交收益 − 按区间首尾收盘价计算的收益（反映择时/滑点/费率）
 *   残差        = 总收益 − 以上三项
 *
 * 关于残差：里面既有真实的个股事件驱动，也有无法解释的噪声。
 * **产品不把它伪装成「个股特质贡献」**——拆不开就不拆，
 * 所以 idiosyncraticPct 固定为 0，残差全部记在 unexplainedPct，并在界面写明原因。
 */

import type { Attribution, Evidence } from './types';
import type { DailyBar } from './providers/types';
import type { Gap } from './evidence';
import { guardNoFutureLeak } from './timewall';
import { shanghaiDate, tradingDayGap } from './time';

export interface AttributionContext {
  /** 当天可见证据（必须已过时点防火墙） */
  evidences: Evidence[];
  cutoffMs: number;
  entryPrice: number;
  entryMs: number;
  exitPrice: number;
  exitMs: number;
  entryFee: number;
  exitFee: number;
  entryQty: number;
  /** 个股日 K（含建仓前 60 日与持有区间） */
  stockBars: DailyBar[];
  indexBars: DailyBar[];
  /** 板块区间收益（已封装为证据） */
  sector: { value: number | null; evidenceId: string | null };
  calendar: string[];
  /** 个股与基准代码，用于生成真实可点开的证据 id */
  stockCode: string;
  indexCode: string;
}

/** 日收益序列 */
function dailyReturns(bars: DailyBar[]): { date: string; r: number }[] {
  const out: { date: string; r: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    if (prev > 0) out.push({ date: shanghaiDate(bars[i].dateMs), r: bars[i].close / prev - 1 });
  }
  return out;
}

/** 对日期对齐后的两组收益做最小二乘，返回 β */
function estimateBeta(stock: DailyBar[], index: DailyBar[]): { beta: number; n: number } | null {
  const s = new Map(dailyReturns(stock).map((x) => [x.date, x.r]));
  const i = new Map(dailyReturns(index).map((x) => [x.date, x.r]));
  const pairs: [number, number][] = [];
  for (const [d, sv] of s) {
    const iv = i.get(d);
    if (iv !== undefined) pairs.push([iv, sv]);
  }
  if (pairs.length < 20) return null;

  const n = pairs.length;
  const meanX = pairs.reduce((a, [, x]) => a + x, 0) / n;
  const meanY = pairs.reduce((a, [x]) => a + x, 0) / n;
  let cov = 0;
  let varX = 0;
  for (const [x, y] of pairs) {
    cov += (x - meanX) * (y - meanY);
    varX += (x - meanX) ** 2;
  }
  if (varX === 0) return null;
  return { beta: cov / varX, n };
}

function closeOnOrBefore(bars: DailyBar[], date: string): number | null {
  let best: DailyBar | null = null;
  for (const b of bars) {
    if (shanghaiDate(b.dateMs) <= date) best = b;
  }
  return best ? best.close : null;
}

function closeOnOrAfter(bars: DailyBar[], date: string): number | null {
  for (const b of bars) {
    if (shanghaiDate(b.dateMs) >= date) return b.close;
  }
  return null;
}

export function computeAttribution(ctx: AttributionContext): { attribution: Attribution; gaps: Gap[] } {
  // P1-2：归因入口必须先过护栏
  guardNoFutureLeak(ctx.evidences, ctx.cutoffMs);

  const gaps: Gap[] = [];
  const degraded: { item: string; reason: string }[] = [];

  const entryDate = shanghaiDate(ctx.entryMs);
  const exitDate = shanghaiDate(ctx.exitMs);
  // 证据 id 与 providers/fuyao.ts 的 barToEvidence 保持一致：`${kind}:${thscode}:${date}`
  const entryBarId = `price:${ctx.stockCode}:${entryDate}`;
  const exitBarId = `price:${ctx.stockCode}:${exitDate}`;
  const indexEntryBarId = `index:${ctx.indexCode}:${entryDate}`;
  const indexExitBarId = `index:${ctx.indexCode}:${exitDate}`;

  // 1. 实际收益（含双边费用）
  const grossAmount = ctx.exitPrice * ctx.entryQty;
  const costAmount = ctx.entryPrice * ctx.entryQty;
  const netAmount = grossAmount - ctx.exitFee - (costAmount + ctx.entryFee);
  const totalReturnPct = (netAmount / (costAmount + ctx.entryFee)) * 100;

  // 2. 市场贡献
  const idxEntry = closeOnOrAfter(ctx.indexBars, entryDate);
  const idxExit = closeOnOrBefore(ctx.indexBars, exitDate);
  const betaWindow = ctx.stockBars.filter((b) => shanghaiDate(b.dateMs) < entryDate).slice(-61);
  const beta = estimateBeta(
    betaWindow,
    ctx.indexBars.filter((b) => shanghaiDate(b.dateMs) < entryDate).slice(-61),
  );
  const betaAnchorIds = betaWindow.length
    ? [
        `price:${ctx.stockCode}:${shanghaiDate(betaWindow[0].dateMs)}`,
        `price:${ctx.stockCode}:${shanghaiDate(betaWindow[betaWindow.length - 1].dateMs)}`,
      ]
    : [];

  let marketPct = 0;
  if (idxEntry && idxExit && beta) {
    const idxReturnPct = (idxExit / idxEntry - 1) * 100;
    marketPct = beta.beta * idxReturnPct;
  } else {
    degraded.push({
      item: '市场β贡献',
      reason: !beta
        ? '建仓前可对齐的日收益样本不足 20 个，无法稳定估计 β'
        : '基准指数区间收盘价缺失',
    });
    gaps.push({
      item: '市场β贡献',
      reason: !beta ? '样本不足（<20 个交易日）' : '指数行情缺失',
      impact: 'marketPct 记为 0，归因面板标注该项降级，整条结论置信度下降',
    });
  }

  // 3. 行业超额
  let sectorPct = 0;
  if (idxEntry && idxExit && ctx.sector.value !== null) {
    const idxReturnPct = (idxExit / idxEntry - 1) * 100;
    sectorPct = ctx.sector.value - idxReturnPct;
  } else {
    degraded.push({ item: '行业超额贡献', reason: '板块区间收益缺失或无法解析' });
    gaps.push({
      item: '行业超额贡献',
      reason: 'iFinD 板块区间涨跌幅未取到或未解析成功',
      impact: 'sectorPct 记为 0 并在面板标注缺失，不伪装成「行业无贡献」',
    });
  }

  // 4. 执行偏差：实际成交 vs 按首尾收盘价买入持有的理论收益
  const closeEntry = closeOnOrAfter(ctx.stockBars, entryDate);
  const closeExit = closeOnOrBefore(ctx.stockBars, exitDate);
  let executionPct = 0;
  let theoreticalPct: number | null = null;
  if (closeEntry && closeExit) {
    theoreticalPct = (closeExit / closeEntry - 1) * 100;
    executionPct = totalReturnPct - theoreticalPct;
  } else {
    degraded.push({ item: '执行偏差', reason: '首尾交易日收盘价缺失' });
  }

  // 5. 残差 —— 先各自四舍五入到 2 位，再由总收益倒推残差，
  //    保证「五项相加严格等于总收益」，不出现 0.01 级的舍入裂缝
  const rounded = {
    total: round2(totalReturnPct),
    market: round2(marketPct),
    sector: round2(sectorPct),
    execution: round2(executionPct),
  };
  const unexplainedPct = round2(rounded.total - rounded.market - rounded.sector - rounded.execution);

  // 持有交易日（口径：交易日，必须有日历）
  let holdingTradingDays: number | null = null;
  try {
    holdingTradingDays = tradingDayGap(ctx.entryMs, ctx.exitMs, ctx.calendar);
  } catch {
    gaps.push({
      item: '持有交易日',
      reason: '交易日历未覆盖持有区间',
      impact: '持有期只能用自然日展示，不用于任何「交易日」判断',
    });
  }

  const attribution: Attribution = {
    totalReturnPct: rounded.total,
    marketPct: rounded.market,
    sectorPct: rounded.sector,
    // 拆不开就不拆：残差里的事件驱动与噪声无法分离
    idiosyncraticPct: 0,
    executionPct: rounded.execution,
    unexplainedPct,
    inputs: {
      实际收益: { value: rounded.total, sourceEvidenceIds: [entryBarId, exitBarId] },
      建仓价: { value: ctx.entryPrice, sourceEvidenceIds: [entryBarId] },
      卖出价: { value: ctx.exitPrice, sourceEvidenceIds: [exitBarId] },
      双边费用: { value: round2(ctx.entryFee + ctx.exitFee), sourceEvidenceIds: [] },
      基准指数收益: {
        value: idxEntry && idxExit ? round2((idxExit / idxEntry - 1) * 100) : null,
        sourceEvidenceIds: [indexEntryBarId, indexExitBarId],
      },
      β: { value: beta ? Number(beta.beta.toFixed(3)) : null, sourceEvidenceIds: betaAnchorIds },
      β样本交易日数: { value: beta ? beta.n : null, sourceEvidenceIds: betaAnchorIds },
      板块区间收益: {
        value: ctx.sector.value,
        sourceEvidenceIds: ctx.sector.evidenceId ? [ctx.sector.evidenceId] : [],
      },
      理论买入持有收益: {
        value: theoreticalPct === null ? null : round2(theoreticalPct),
        sourceEvidenceIds: [entryBarId, exitBarId],
      },
      持有交易日: { value: holdingTradingDays, sourceEvidenceIds: [] },
    },
    degraded: [
      ...degraded,
      {
        item: '个股特质（事件驱动）',
        reason: '公告与资讯对价格的影响无法与噪声分离，产品不做伪量化',
      },
    ],
  };

  return { attribution, gaps };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
