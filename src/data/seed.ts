/**
 * 种子数据 · 三笔真实交易
 *
 * 所有价格、日期、热榜排名均为扶摇真实数据（取数时间 2026-10-25），
 * 不是编的。用户身份、仓位、当时的心理活动为构造（题目要求匿名/构造画像）。
 *
 * 三笔交易刻意覆盖三种典型情形，便于演示「同样亏损，原因完全不同」：
 *   T1 兆易创新  赚了就跑，之后又涨 —— 卖出规则缺失
 *   T2 长鑫科技  追热榜第一，冲高没走，最后割 —— 无证伪条件 + 追涨
 *   T3 贵州茅台  对照样本，拿着不动小亏 —— 用来避免「只复盘失败」的取样偏差
 */

import type { DecisionRecord, Hypothesis, Trade } from '@/lib/types';
import { parseDateTime } from '@/lib/time';

export const SEED_TRADES: Trade[] = [
  {
    id: 'T1',
    thscode: '603986.SH',
    name: '兆易创新',
    side: 'buy',
    tradedAtMs: parseDateTime('2026-08-03 10:23'),
    price: 340.74,
    qty: 200,
    amount: 340.74 * 200,
    fee: 20.44,
    positionId: 'P1',
    entrySource: 'seed',
    positionWeight: 0.28,
    sectorQuery: '电子->半导体->集成电路',
  },
  {
    id: 'T1-exit',
    thscode: '603986.SH',
    name: '兆易创新',
    side: 'sell',
    tradedAtMs: parseDateTime('2026-08-05 14:12'),
    price: 385.44,
    qty: 200,
    amount: 385.44 * 200,
    fee: 23.13,
    positionId: 'P1',
    entrySource: 'seed',
    positionWeight: 0.28,
  },
  {
    id: 'T2',
    thscode: '688825.SH',
    name: '长鑫科技',
    side: 'buy',
    tradedAtMs: parseDateTime('2026-08-03 09:47'),
    price: 54.99,
    qty: 2000,
    amount: 54.99 * 2000,
    fee: 32.99,
    positionId: 'P2',
    entrySource: 'seed',
    positionWeight: 0.41,
    sectorQuery: '电子->半导体->集成电路',
  },
  {
    id: 'T2-exit',
    thscode: '688825.SH',
    name: '长鑫科技',
    side: 'sell',
    tradedAtMs: parseDateTime('2026-10-22 14:03'),
    price: 39.7,
    qty: 2000,
    amount: 39.7 * 2000,
    fee: 23.82,
    positionId: 'P2',
    entrySource: 'seed',
    positionWeight: 0.41,
  },
  {
    id: 'T3',
    thscode: '600519.SH',
    name: '贵州茅台',
    side: 'buy',
    tradedAtMs: parseDateTime('2026-08-03 13:51'),
    price: 1358.98,
    qty: 100,
    amount: 135898,
    fee: 81.54,
    positionId: 'P3',
    entrySource: 'seed',
    positionWeight: 0.31,
    sectorQuery: '食品饮料->酒类->白酒',
  },
  {
    id: 'T3-exit',
    thscode: '600519.SH',
    name: '贵州茅台',
    side: 'sell',
    tradedAtMs: parseDateTime('2026-09-15 10:08'),
    price: 1272.75,
    qty: 100,
    amount: 127275,
    fee: 76.37,
    positionId: 'P3',
    entrySource: 'seed',
    positionWeight: 0.31,
  },
];

/**
 * 假设台账（事后补写）
 *
 * 注意：三笔都是 recall_only —— 复盘时用户才被要求写下「当时怎么想的」，
 * 按设计它们不能计入归因权重，界面会显著标注「事后回忆」。
 * 这不是数据缺陷，恰恰是产品要暴露的问题。
 */
export const SEED_HYPOTHESES: Record<string, Hypothesis> = {
  T1: {
    claim: '存储涨价周期延续，利基存储龙头中报后会有第二波，目标看前高',
    trigger: '放量站上 380 且板块同步走强',
    falsify: '跌破 330，或存储现货报价连续两周回落',
    horizonTradingDays: 20,
    expectedRangePct: [12, 25],
    counterView: '涨幅已经很大，机构可能借中报兑现出货',
    authoredBy: 'ai_assisted',
    createdAtMs: parseDateTime('2026-10-25 21:30'),
    selfReportedWrittenAt: null,
    anchor: 'recall_only',
    isBackfilled: true,
  },
  T2: {
    claim: '新股上市后热度排到第一，存储题材正热，应该还有连板空间',
    trigger: '次日高开超过 3% 就加仓',
    falsify: '没有专门想过什么情况下算错',
    horizonTradingDays: 5,
    expectedRangePct: [20, 40],
    counterView: '没有反方观点，当时觉得题材够硬',
    authoredBy: 'user',
    createdAtMs: parseDateTime('2026-10-25 21:34'),
    selfReportedWrittenAt: null,
    anchor: 'recall_only',
    isBackfilled: true,
  },
  T3: {
    claim: '中报兑现后估值修复，白酒板块在四季度有旺季行情',
    trigger: '站上 1400 并放量',
    falsify: '跌破 1300 就减半仓',
    horizonTradingDays: 40,
    expectedRangePct: [8, 15],
    counterView: '消费复苏力度不确定，机构在减仓白酒',
    authoredBy: 'user',
    createdAtMs: parseDateTime('2026-10-25 21:40'),
    selfReportedWrittenAt: null,
    anchor: 'recall_only',
    isBackfilled: true,
  },
};

/** 数据来源说明，会展示在界面上 */
export const SEED_PROVENANCE =
  '价格、日期、热榜排名来自扶摇金融数据 API（取数于 2026-10-25）；用户画像与仓位为构造数据。';

/**
 * 一条历史决策记录（构造）
 *
 * 用于演示回检链路：2026-09-01 决定加仓兆易创新，写下「跌破 330 就承认判断错」。
 * 之后股价确实跌破 330（10-22 最低 276.75），证伪条件被触及 ——
 * 回检页会把这个事实摆出来，并请用户自述当时有没有执行。
 */
export const SEED_DECISIONS: DecisionRecord[] = [
  {
    id: 'D-SEED-1',
    thscode: '603986.SH',
    name: '兆易创新',
    createdAtMs: parseDateTime('2026-09-01 10:30'),
    plannedPrice: 372,
    falsify: '跌破 330 就承认判断错，减仓一半',
    sectorQuery: '电子->半导体->集成电路',
    checkedAssetIds: [],
    check: null,
  },
];
