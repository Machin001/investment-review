/**
 * 决策回检
 *
 * 没有回检，「清单有效」就只是自我感觉。这里只做两件事：
 *   1. 把决策之后实际发生了什么算出来（价格、回撤、证伪阈值是否触及）
 *   2. 让用户自述「那几条清单你到底执行了没有」，并记录在案
 *
 * 自动部分全部可复算；人工部分明确标为自述，不与事实混为一谈。
 */

import type { DecisionFacts, DecisionRecord } from './types';
import type { DailyBar } from './providers/types';
import type { Gap } from './evidence';
import { fuyao } from './providers/fuyao';
import { dayStartMs, shanghaiDate, tradingDayGap } from './time';

const DAY = 86_400_000;

export interface DecisionCheckView {
  decision: DecisionRecord;
  facts: DecisionFacts;
  gaps: Gap[];
  /** 是否已经过了足够时间、值得回检 */
  dueForCheck: boolean;
}

/**
 * 从证伪条件的自然语言里解析价格阈值。
 *
 * 只认「跌破 / 低于 / 下破 / 站上 / 突破 / 高于」+ 价格数字这种明确句式，
 * 并且要求数字后面**不是**日/天/%/倍/个 等单位 ——
 * 「低于 20 日均线」里的 20 是均线周期，不是价格阈值，不能被误当成 330 那样的价位。
 * 解析不出就返回 null，绝不猜。
 */
export function parseFalsifyThreshold(text: string | null): { value: number; direction: 'down' | 'up' } | null {
  if (!text) return null;
  // 数字前后都加边界断言：否则 "20 日" 会被回溯成 "2" 匹配成功
  const NUM = '(?<![0-9.])([0-9]+(?:\\.[0-9]+)?)(?![0-9.])(?!\\s*(?:日|天|%|％|倍|个|周|月|年))';
  const down = new RegExp(`(跌破|低于|下破|跌穿|回落到)\\s*${NUM}`).exec(text);
  if (down) return { value: Number(down[2]), direction: 'down' };
  const up = new RegExp(`(站上|突破|高于|涨过|升破)\\s*${NUM}`).exec(text);
  if (up) return { value: Number(up[2]), direction: 'up' };
  return null;
}

function barsSince(bars: DailyBar[], dateMs: number): DailyBar[] {
  return bars.filter((b) => shanghaiDate(b.dateMs) >= shanghaiDate(dateMs));
}

export async function buildDecisionCheck(decision: DecisionRecord): Promise<DecisionCheckView> {
  const gaps: Gap[] = [];
  const now = Date.now();

  const empty: DecisionFacts = {
    tradingDays: null,
    returnPct: null,
    maxDrawdownPct: null,
    falsifyThreshold: null,
    falsifyTriggered: null,
    basePrice: decision.plannedPrice,
    asOfDate: null,
  };

  let bars: DailyBar[] = [];
  try {
    bars = await fuyao.getStockBars(decision.thscode, decision.createdAtMs - 5 * DAY, now);
  } catch (err) {
    gaps.push({
      item: `决策 ${decision.name} 的后续行情`,
      reason: (err as Error).message.slice(0, 160),
      impact: '无法回检这笔决策，界面显示为「回检数据缺失」而不是「没有变化」',
    });
    return { decision, facts: empty, gaps, dueForCheck: false };
  }

  const after = barsSince(bars, decision.createdAtMs);
  if (after.length === 0) {
    gaps.push({
      item: `决策 ${decision.name} 的后续行情`,
      reason: '决策日之后还没有交易日数据',
      impact: '尚不能回检，等待下一个交易日',
    });
    return { decision, facts: empty, gaps, dueForCheck: false };
  }

  // 基准价优先用决策当时的计划买入价；没有则退化为决策日收盘价（口径会在界面标注）
  const basePrice = decision.plannedPrice ?? after[0].close;
  const last = after[after.length - 1];
  const lowest = Math.min(...after.map((b) => b.low));
  const highest = Math.max(...after.map((b) => b.high));

  let tradingDays: number | null = null;
  try {
    const calendar = await fuyao.getTradingCalendar(decision.createdAtMs, now);
    tradingDays = tradingDayGap(decision.createdAtMs, dayStartMs(shanghaiDate(last.dateMs)), calendar);
  } catch (err) {
    gaps.push({
      item: '决策后的交易日数',
      reason: (err as Error).message.slice(0, 160),
      impact: '只展示自然日，不用于任何「交易日」判断',
    });
  }

  const threshold = parseFalsifyThreshold(decision.falsify);
  let triggered: boolean | null = null;
  if (threshold) {
    triggered = threshold.direction === 'down' ? lowest <= threshold.value : highest >= threshold.value;
  } else if (decision.falsify) {
    gaps.push({
      item: '证伪条件是否被触及',
      reason: `「${decision.falsify}」里没有可解析的价格阈值`,
      impact: '该项无法自动判定，需你自行对照，界面不给出结论',
    });
  }

  const facts: DecisionFacts = {
    tradingDays,
    returnPct: basePrice > 0 ? round2((last.close / basePrice - 1) * 100) : null,
    maxDrawdownPct: basePrice > 0 ? round2((lowest / basePrice - 1) * 100) : null,
    falsifyThreshold: threshold ? threshold.value : null,
    falsifyTriggered: triggered,
    basePrice,
    asOfDate: shanghaiDate(last.dateMs),
  };

  return {
    decision,
    facts,
    gaps,
    // 至少过了一个交易日、且有 5 个交易日观察窗才提示回检
    dueForCheck: (facts.tradingDays ?? 0) >= 5 && decision.check === null,
  };
}

export async function buildDecisionChecks(decisions: DecisionRecord[]): Promise<DecisionCheckView[]> {
  const out: DecisionCheckView[] = [];
  for (const d of decisions) {
    out.push(await buildDecisionCheck(d));
  }
  // 待回检的排前面
  return out.sort((a, b) => Number(b.dueForCheck) - Number(a.dueForCheck) || b.decision.createdAtMs - a.decision.createdAtMs);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ExecutionStats {
  total: number;
  checked: number;
  pending: number;
  /** 自述「完全执行」的比例，只统计已回检的 */
  followedRate: number | null;
  /** 证伪条件被触及的次数（仅统计可判定的） */
  falsifyTriggeredCount: number;
  falsifyJudgeable: number;
}

export function executionStats(views: DecisionCheckView[]): ExecutionStats {
  const checked = views.filter((v) => v.decision.check !== null);
  const judgeable = views.filter((v) => v.facts.falsifyTriggered !== null);
  return {
    total: views.length,
    checked: checked.length,
    pending: views.length - checked.length,
    followedRate: checked.length
      ? checked.filter((v) => v.decision.check!.verdict === 'followed').length / checked.length
      : null,
    falsifyTriggeredCount: judgeable.filter((v) => v.facts.falsifyTriggered).length,
    falsifyJudgeable: judgeable.length,
  };
}
