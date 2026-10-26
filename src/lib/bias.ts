/**
 * 行为偏差规则库
 *
 * 关键原则：偏差不是模型「感觉」出来的，每条都必须有可复算的判定条件 + 命中的硬证据。
 * 样本不足时只报「样本不足」，不下结论。
 */

import type { BiasHit, Hypothesis, Trade } from './types';
import type { DailyBar } from './providers/types';
import { shanghaiDate, dayCloseMs } from './time';

export interface BiasContext {
  hypothesis: Hypothesis | null;
  entry: Trade;
  exit: Trade | null;
  /** 该股完整日 K（建仓前 60 日至最新） */
  bars: DailyBar[];
  /** 建仓日热榜排名，未上榜为 null */
  hotRank: number | null;
  /** 建仓日龙虎榜净买入（元），未上榜为 null */
  dragonTigerNetValue: number | null;
  totalReturnPct: number;
  holdingTradingDays: number | null;
  /** 用于把偏差挂到可点开的证据上 */
  evidence: {
    entryBarId: string | null;
    hotRankId: string | null;
    dragonTigerId: string | null;
    exitBarId: string | null;
  };
}

/**
 * 判定「等于没写」的证伪条件。
 * 覆盖三类：完全空白、短占位词（没有/无/未设）、否定式表述（没有专门想过什么情况下算错）。
 */
const EMPTY_FALSIFY =
  /^(|没想过|没有|无|未设|暂无|不知道|不知道|—+|-+)$|(没有|没|未|不)(专门|认真|仔细)?(想过|设|考虑过|定义过|想好)/;

export function computeBiasHits(ctx: BiasContext): BiasHit[] {
  const hits: BiasHit[] = [];
  const entryDate = shanghaiDate(ctx.entry.tradedAtMs);

  // R1 证伪条件缺失 —— 复盘能否成立的前提
  const falsify = (ctx.hypothesis?.falsify ?? '').trim();
  if (!ctx.hypothesis || EMPTY_FALSIFY.test(falsify)) {
    hits.push({
      code: 'no_falsify_condition',
      label: '没有证伪条件',
      evidenceText: ctx.hypothesis
        ? `你写下的证伪条件是「${falsify || '空'}」，无法据此判断这笔到底错在哪一步`
        : '这笔交易没有留下任何假设记录',
      evidenceIds: [],
      rule: '假设台账的 falsify 字段为空、或内容为「没想过 / 没有 / 无」类占位词',
      severity: 3,
      sampleSize: 1,
    });
  }

  // R2 追涨：建仓价距前 20 个交易日最高价 < 3%
  const before = ctx.bars.filter((b) => shanghaiDate(b.dateMs) < entryDate).slice(-20);
  if (before.length >= 10) {
    const high20 = Math.max(...before.map((b) => b.high));
    const gapPct = ((ctx.entry.price - high20) / high20) * 100;
    if (gapPct > -3) {
      hits.push({
        code: 'chase_high',
        label: '在阶段高位附近买入',
        evidenceText: `建仓价 ${ctx.entry.price} 距前 20 个交易日最高价 ${high20.toFixed(2)} 仅 ${gapPct.toFixed(2)}%`,
        evidenceIds: ctx.evidence.entryBarId ? [ctx.evidence.entryBarId] : [],
        rule: '(建仓价 − 前 20 交易日最高价) / 前 20 交易日最高价 > −3%',
        severity: 2,
        sampleSize: before.length,
      });
    }
  } else {
    hits.push({
      code: 'chase_high',
      label: '在阶段高位附近买入',
      evidenceText: `建仓前仅 ${before.length} 个交易日数据，不足以判断买入位置`,
      evidenceIds: [],
      rule: '(建仓价 − 前 20 交易日最高价) / 前 20 交易日最高价 > −3%',
      severity: 1,
      sampleSize: before.length,
      lowSample: true,
    });
  }

  // R3 热度驱动：建仓日进入同花顺热榜前 10
  if (ctx.hotRank !== null && ctx.hotRank <= 10) {
    hits.push({
      code: 'hot_rank_driven',
      label: '按市场热度而非自身逻辑建仓',
      evidenceText: `建仓当日该股在热榜排名第 ${ctx.hotRank} 位`,
      evidenceIds: ctx.evidence.hotRankId ? [ctx.evidence.hotRankId] : [],
      rule: '建仓日 hot_stock_list_history 排名 ≤ 10',
      severity: 2,
      sampleSize: 1,
    });
  }

  // R7 资金方向相背：建仓日龙虎榜净卖出超过 5000 万
  if (ctx.dragonTigerNetValue !== null && ctx.dragonTigerNetValue < -5_000_000) {
    const yi = ctx.dragonTigerNetValue / 1e8;
    hits.push({
      code: 'capital_flow_against',
      label: '在主力资金净流出当天买入',
      evidenceText: `建仓当日龙虎榜净卖出 ${Math.abs(yi).toFixed(2)} 亿，你的方向与当天披露的资金方向相反`,
      evidenceIds: ctx.evidence.dragonTigerId ? [ctx.evidence.dragonTigerId] : [],
      rule: '建仓日 dragon-tiger-list 的 net_value < −5000 万元',
      severity: 2,
      sampleSize: 1,
    });
  }

  // R4 卖出后继续上涨：卖出后 10 个交易日内最高收盘 > 卖出价 × 1.10
  if (ctx.exit) {
    const exitDate = shanghaiDate(ctx.exit.tradedAtMs);
    const afterExit = ctx.bars.filter((b) => shanghaiDate(b.dateMs) > exitDate).slice(0, 10);
    if (afterExit.length >= 5) {
      const peak = Math.max(...afterExit.map((b) => b.close));
      const beyond = ((peak - ctx.exit.price) / ctx.exit.price) * 100;
      if (beyond > 10) {
        hits.push({
          code: 'early_exit_no_rule',
          // 标签只陈述可验证的事实；「只按盈亏感觉决定」是推断，不能写进判定结论
          label: '卖出后价格继续上行超 10%',
          evidenceText:
            `卖出后 10 个交易日内最高收盘 ${peak.toFixed(2)}，较卖出价再涨 ${beyond.toFixed(1)}%。` +
            `这条只说明你卖在了阶段性低位附近，是否「卖错」取决于你当时的卖出理由 —— 而台账里没有记录它`,
          evidenceIds: [ctx.evidence.exitBarId ?? ''].filter(Boolean),
          rule: '卖出后 10 个交易日内最高收盘 / 卖出价 − 1 > 10%',
          severity: 2,
          sampleSize: afterExit.length,
        });
      }
    }
  }

  // R5 仓位过度集中
  if (ctx.entry.positionWeight !== undefined && ctx.entry.positionWeight > 0.4) {
    hits.push({
      code: 'concentration',
      label: '单票仓位过重',
      evidenceText: `该笔占当时总仓位 ${(ctx.entry.positionWeight * 100).toFixed(0)}%`,
      evidenceIds: [],
      rule: 'positionWeight > 40%（来自录入的仓位字段，非估算）',
      severity: 2,
      sampleSize: 1,
    });
  }

  // R6 亏损单长期持有且从未触发自己的证伪条件
  if (
    ctx.totalReturnPct < 0 &&
    ctx.holdingTradingDays !== null &&
    ctx.holdingTradingDays > 20 &&
    !EMPTY_FALSIFY.test(falsify) &&
    falsify
  ) {
    hits.push({
      code: 'hold_loser_past_rule',
      label: '持有亏损单的时间超过了自己设定的周期',
      evidenceText: `持有 ${ctx.holdingTradingDays} 个交易日，区间收益 ${ctx.totalReturnPct.toFixed(2)}%，期间未按自己写下的证伪条件动作`,
      evidenceIds: ctx.evidence.exitBarId ? [ctx.evidence.exitBarId] : [],
      rule: '区间收益 < 0 且持有交易日 > 20 且存在非空证伪条件',
      severity: 2,
      sampleSize: 1,
    });
  }

  return hits;
}

/** 供界面提示：这条偏差是否因样本不足而不构成结论 */
export function isConclusive(hit: BiasHit): boolean {
  return !hit.lowSample;
}

/** 建仓日收盘价所在 K 线的证据 id（便于点开溯源） */
export function entryBarEvidenceId(thscode: string, tradedAtMs: number): string {
  return `price:${thscode}:${shanghaiDate(tradedAtMs)}`;
}

export { dayCloseMs };
