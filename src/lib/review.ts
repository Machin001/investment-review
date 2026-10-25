/**
 * 复盘会话装配
 *
 * 一次复盘 = 取数 → 归一化为证据 → 过时点防火墙 → 归因 → 偏差 → 沉淀学习资产。
 * 任何一环取不到数据，都进 gaps，界面上显式展示，不静默。
 */

import type {
  Evidence,
  Hypothesis,
  LearningAsset,
  ReviewSession,
  Trade,
  VisibilityJudgement,
} from './types';
import type { DailyBar } from './providers/types';
import { fuyao, barToEvidence } from './providers/fuyao';
import { searchNotices, getSectorEvidence } from './providers/ifind';
import { partitionByCutoff, dataCompleteness } from './timewall';
import { detectConflicts, summarizeConflicts, gapOf } from './evidence';
import type { ConflictSummary, Gap } from './evidence';
import { computeAttribution } from './attribution';
import { computeBiasHits } from './bias';
import { dayCloseMs, shanghaiDate } from './time';

export type Viewpoint = 'entry' | 'exit' | 'today';

export interface TimelinePayload {
  sessionId: string;
  entry: Trade;
  exit: Trade | null;
  hypothesis: Hypothesis | null;
  viewpoint: Viewpoint;
  cutoffMs: number;
  cutoffLabel: string;
  visible: Evidence[];
  after: Evidence[];
  uncertain: Evidence[];
  unknownTime: Evidence[];
  judgements: Record<string, VisibilityJudgement>;
  conflicts: ConflictSummary[];
  gaps: Gap[];
  completeness: number;
  attribution: ReturnType<typeof computeAttribution>['attribution'] | null;
  biasHits: ReviewSession['biasHits'];
  assets: LearningAsset[];
  /** 行情基准、取数时刻等，便于界面标注 */
  meta: {
    benchmark: string;
    fetchedAt: string;
    decisionDayNote: string | null;
    reviewCutoffMs: number;
  };
}

const DAY = 86_400_000;

/** 把异常转成缺口，而不是让整个页面 500 */
function asGap(item: string, err: unknown): Gap {
  const msg = err instanceof Error ? err.message : String(err);
  return gapOf(item, msg.slice(0, 200), `${item}相关证据缺失，对应结论标注降级`);
}

export async function buildReview(opts: {
  entry: Trade;
  exit: Trade | null;
  hypothesis: Hypothesis | null;
  viewpoint: Viewpoint;
  /** 复盘时点，默认为现在 */
  reviewAtMs?: number;
}): Promise<TimelinePayload> {
  const { entry, exit, hypothesis } = opts;
  const reviewAt = opts.reviewAtMs ?? Date.now();
  const gaps: Gap[] = [];

  const cutoffMs =
    opts.viewpoint === 'entry' ? entry.tradedAtMs : opts.viewpoint === 'exit' && exit ? exit.tradedAtMs : reviewAt;
  const cutoffLabel =
    opts.viewpoint === 'entry' ? '买入时点' : opts.viewpoint === 'exit' && exit ? '卖出时点' : '今天回看';

  const fetchStart = Math.min(entry.tradedAtMs, exit?.tradedAtMs ?? entry.tradedAtMs) - 120 * DAY;
  const fetchEnd = Math.max(reviewAt, exit?.tradedAtMs ?? 0);

  const evidences: Evidence[] = [];
  let stockBars: DailyBar[] = [];
  let indexBars: DailyBar[] = [];
  let calendar: string[] = [];
  let hotRank: number | null = null;

  // 1. 个股日 K
  try {
    stockBars = await fuyao.getStockBars(entry.thscode, fetchStart, fetchEnd);
    for (const b of stockBars) {
      evidences.push(barToEvidence(b, { thscode: entry.thscode, name: entry.name, kind: 'price' }));
    }
  } catch (err) {
    gaps.push(asGap('个股行情', err));
  }

  // 2. 基准指数
  const BENCH = '000300.SH';
  try {
    indexBars = await fuyao.getIndexBars(BENCH, fetchStart, fetchEnd);
    for (const b of indexBars) {
      evidences.push(barToEvidence(b, { thscode: BENCH, name: '沪深300', kind: 'index' }));
    }
  } catch (err) {
    gaps.push(asGap('基准指数', err));
  }

  // 3. 交易日历
  try {
    calendar = await fuyao.getTradingCalendar(fetchStart, fetchEnd);
    if (calendar.length === 0) {
      gaps.push(gapOf('交易日历', '接口返回区间内没有交易日', '持有期只能用自然日展示'));
    }
  } catch (err) {
    gaps.push(asGap('交易日历', err));
  }

  // 4. 建仓日热榜（决策当时的信息）
  const entryDate = shanghaiDate(entry.tradedAtMs);
  try {
    const hot = await fuyao.getHotList(entryDate, 50);
    const hit = hot.find((h) => h.thscode === entry.thscode);
    if (hit) {
      hotRank = hit.rank;
      evidences.push({
        id: `hot:${entry.thscode}:${entryDate}`,
        type: 'hot_rank',
        level: 'A',
        title: `${entry.name} 进入同花顺热榜第 ${hit.rank} 位`,
        summary: `${entryDate} 热榜排名 ${hit.rank}（当日榜首为 ${hot[0]?.name ?? '—'}）`,
        symbol: entry.thscode,
        publishedAtMs: dayCloseMs(entryDate),
        publishedDate: entryDate,
        timePrecision: 'ms',
        source: {
          provider: 'fuyao',
          endpoint: 'GET /api/a-share/special-data/hot-stock-list-history',
          fetchedAtMs: Date.now(),
          caliber: '同花顺热榜按自然日返回，排名取当日收盘后的榜单结果',
        },
        metric: { key: 'market.hot_rank', value: hit.rank, unit: '位' },
        raw: hit as unknown as Record<string, unknown>,
      });
    }
  } catch (err) {
    gaps.push(asGap('热榜排名', err));
  }

  // 5. 建仓日市场情绪
  try {
    const stats = await fuyao.getLimitUpStats(entryDate);
    evidences.push({
      id: `limitup:${entryDate}`,
      type: 'limit_up_stat',
      level: 'A',
      title: `${entryDate} 全市场涨停 ${stats.limitUpCount} 家`,
      summary: `封板率 ${(stats.sealRate * 100).toFixed(1)}%，炸板 ${stats.openCount} 家`,
      publishedAtMs: dayCloseMs(entryDate),
      publishedDate: entryDate,
      timePrecision: 'ms',
      source: {
        provider: 'fuyao',
        endpoint: 'GET /api/a-share/special-data/limit-up-statistics',
        fetchedAtMs: Date.now(),
        caliber: '涨停家数含一字板与换手板；封板率 = 收盘封住/触及涨停',
      },
      metric: { key: 'market.limit_up_count', value: stats.limitUpCount, unit: '家' },
      raw: stats as unknown as Record<string, unknown>,
    });
  } catch (err) {
    gaps.push(asGap('市场情绪（涨停统计）', err));
  }

  // 6. 公告（iFinD 语义检索，日期粒度）
  const noticeFrom = shanghaiDate(cutoffMs - 45 * DAY);
  const noticeTo = shanghaiDate(Math.min(reviewAt, cutoffMs + 45 * DAY));
  try {
    const notices = await searchNotices(`${entry.name} 公告 经营 业绩`, {
      timeStart: noticeFrom,
      timeEnd: noticeTo,
      size: 6,
      symbol: entry.thscode,
    });
    evidences.push(...notices);
  } catch (err) {
    gaps.push(asGap('公告检索', err));
  }

  // 7. 行业板块收益（归因用，事后信息）
  //    行业必须与标的匹配，缺失时整项降级，不拿别的行业凑数
  let sector: { value: number | null; evidenceId: string | null } = { value: null, evidenceId: null };
  if (exit && entry.sectorQuery) {
    try {
      const r = await getSectorEvidence(entry.sectorQuery, shanghaiDate(entry.tradedAtMs), shanghaiDate(exit.tradedAtMs));
      evidences.push(r.evidence);
      sector = { value: r.value, evidenceId: r.evidence.id };
      if (r.gap) gaps.push(r.gap);
    } catch (err) {
      gaps.push(asGap('行业板块收益', err));
    }
  } else if (!entry.sectorQuery) {
    gaps.push(
      gapOf('行业板块收益', '该笔交易没有标注所属行业', '行业超额贡献无法计算，归因面板该项显示缺失'),
    );
  }

  // 决策日盘中行情缺失说明（P1-3）
  // 必须在分组前算出来：说明本身要作为一条证据参与分组，出现在时间线的决策时点位置
  const isIntradayDecision = shanghaiDate(cutoffMs) === entryDate && cutoffMs < dayCloseMs(entryDate);
  const hasSameDayVisiblePrice = evidences.some(
    (e) =>
      e.type === 'price' &&
      e.symbol === entry.thscode &&
      e.publishedDate === entryDate &&
      e.publishedAtMs !== null &&
      e.publishedAtMs <= cutoffMs,
  );
  let decisionDayNote: string | null = null;
  if (isIntradayDecision && !hasSameDayVisiblePrice) {
    decisionDayNote =
      `你在 ${entryDate} 盘中做出决策，而日 K 收盘价要到当日 15:00 才确定，` +
      `因此当天的收盘价属于事后信息，不能进入「当时的我」。当前数据源只提供日线，无分钟级行情，` +
      `所以决策时点的盘面上下文为空白 —— 这是数据能力边界，不是数据缺失。`;

    evidences.push({
      id: `note:decision-day:${entry.id}`,
      type: 'user_note',
      level: 'C',
      title: '决策时点没有盘面数据（系统说明）',
      summary: decisionDayNote,
      symbol: entry.thscode,
      publishedAtMs: cutoffMs,
      publishedDate: entryDate,
      timePrecision: 'ms',
      source: {
        provider: 'derived',
        endpoint: 'system:decision-day-note',
        fetchedAtMs: Date.now(),
        caliber: '系统生成的说明性条目，不是市场数据，不参与归因权重与完整度计算',
      },
    });

    gaps.push(
      gapOf('决策时点盘中行情', '数据源仅提供日 K，无分钟线', '决策当日的“当时的我”视图没有价格上下文，相关判断无法被验证'),
    );
  }

  // 冲突检测：两源不一致时双方都保留
  detectConflicts(evidences);
  const conflicts = summarizeConflicts(evidences);

  // 时点防火墙
  const partition = partitionByCutoff(evidences, cutoffMs);
  const judgements: Record<string, VisibilityJudgement> = {};
  for (const [id, j] of partition.judgements) judgements[id] = j;

  const completeness = dataCompleteness(evidences, cutoffMs);

  // 归因（入口已过护栏）
  let attribution: TimelinePayload['attribution'] = null;
  if (exit && stockBars.length > 0 && indexBars.length > 0) {
    try {
      const { attribution: attr, gaps: attrGaps } = computeAttribution({
        evidences: partition.visible,
        // 归因是回溯计算，使用时点为复盘时点；这里传入复盘时点作为上界
        cutoffMs: reviewAt,
        entryPrice: entry.price,
        entryMs: entry.tradedAtMs,
        exitPrice: exit.price,
        exitMs: exit.tradedAtMs,
        entryFee: entry.fee,
        exitFee: exit.fee,
        entryQty: entry.qty,
        stockBars,
        indexBars: indexBars,
        sector,
        calendar,
      });
      attribution = attr;
      gaps.push(...attrGaps);
    } catch (err) {
      gaps.push(asGap('收益归因', err));
    }
  } else if (!exit) {
    gaps.push(gapOf('收益归因', '该笔尚未卖出', '未平仓无法计算区间归因，仅展示时间线与假设'));
  }

  // 偏差
  const biasHits = computeBiasHits({
    hypothesis,
    entry,
    exit,
    bars: stockBars,
    hotRank,
    totalReturnPct: attribution?.totalReturnPct ?? 0,
    holdingTradingDays: (attribution?.inputs['持有交易日']?.value as number | null) ?? null,
    evidence: {
      entryBarId: `price:${entry.thscode}:${entryDate}`,
      hotRankId: hotRank !== null ? `hot:${entry.thscode}:${entryDate}` : null,
      exitBarId: exit ? `price:${entry.thscode}:${shanghaiDate(exit.tradedAtMs)}` : null,
    },
  });

  const sessionId = `S-${entry.id}`;
  const assets = buildLearningAssets({ sessionId, biasHits, entry, attribution });

  return {
    sessionId,
    entry,
    exit,
    hypothesis,
    viewpoint: opts.viewpoint,
    cutoffMs,
    cutoffLabel,
    visible: partition.visible,
    after: partition.after,
    uncertain: partition.uncertain,
    unknownTime: partition.unknownTime,
    judgements,
    conflicts,
    gaps,
    completeness,
    attribution,
    biasHits,
    assets,
    meta: {
      benchmark: BENCH,
      fetchedAt: new Date().toISOString(),
      decisionDayNote,
      reviewCutoffMs: reviewAt,
    },
  };
}

/**
 * 沉淀：把偏差与归因转成下次能直接用的东西
 * 三类资产：检查清单项 / 提醒卡 / 错误词典
 */
export function buildLearningAssets(opts: {
  sessionId: string;
  biasHits: ReviewSession['biasHits'];
  entry: Trade;
  attribution: TimelinePayload['attribution'];
}): LearningAsset[] {
  const { sessionId, biasHits, entry, attribution } = opts;
  const now = Date.now();
  const out: LearningAsset[] = [];

  const push = (kind: LearningAsset['kind'], content: string, trigger: string, code: string) => {
    out.push({
      // id 必须包含 kind：同一个偏差常常同时产出「清单项」和「提醒卡」，
      // 只用 code 会导致两者 id 相撞，落库时后一条静默覆盖前一条
      id: `asset:${kind}:${code}:${sessionId}`,
      kind,
      content,
      trigger,
      fromSessionId: sessionId,
      version: 1,
      createdAtMs: now,
      usageCount: 0,
      lastVerifiedAtMs: null,
    });
  };

  for (const hit of biasHits) {
    switch (hit.code) {
      case 'no_falsify_condition':
        push(
          'checklist_item',
          '下单前写下一条证伪条件：什么价格 / 什么事件出现，我就承认自己错了',
          '任何新建仓决策',
          'no_falsify_condition',
        );
        push(
          'error_dictionary',
          '反复出现的模式：只写“为什么买”，不写“什么时候算错”，导致亏损时只能凭感觉扛或割',
          `标的：${entry.name}；触发情境：题材热度高、时间紧`,
          'no_falsify_condition',
        );
        break;
      case 'chase_high':
        push(
          'checklist_item',
          '先看当前价距 20 日高点的位置，高于 −3% 时要求自己说明“为什么现在这个价位还值得买”',
          '买入前价格检查',
          'chase_high',
        );
        push('reminder_card', `上次在阶段高位买入 ${entry.name} 的结果已记录，本次先核对买入位置`, '同标的或同板块新建仓', 'chase_high');
        break;
      case 'hot_rank_driven':
        push(
          'checklist_item',
          '如果建仓理由是“它在热榜上”，先写下不看盘面也成立的产业逻辑，写不出就不买',
          '热榜前 10 的标的',
          'hot_rank_driven',
        );
        push('reminder_card', `热榜驱动的建仓在 ${entry.name} 上出现过，先确认这不是唯一理由`, '标的进入热榜前 10', 'hot_rank_driven');
        break;
      case 'early_exit_no_rule':
        push(
          'checklist_item',
          '卖出也要有规则：写下卖出触发条件（估值、目标价、证伪条件），而不是按浮盈百分比决定',
          '任何卖出决策',
          'early_exit_no_rule',
        );
        push('error_dictionary', '反复出现的模式：只给买入定规则，不给卖出定规则，赚小钱跑、亏大钱扛', '盈利达到 5%~15% 时', 'early_exit_no_rule');
        break;
      case 'concentration':
        push('checklist_item', '单票仓位上限先定好，超过 40% 需要写下额外理由', '建仓金额确认前', 'concentration');
        break;
      case 'hold_loser_past_rule':
        push(
          'checklist_item',
          '持有超过自己设定周期的亏损单，必须重新走一遍证伪条件，而不是“再看看”',
          '持有亏损单超过预期周期',
          'hold_loser_past_rule',
        );
        break;
      default:
        break;
    }
  }

  if (attribution && attribution.totalReturnPct > 0 && biasHits.some((h) => h.code === 'hot_rank_driven')) {
    push(
      'reminder_card',
      '这次赚钱的过程里有热度驱动成分，赚钱不等于决策正确，下次同样情形仍要按清单检查',
      '同类情形再次出现时',
      'lucky_win',
    );
  }

  return out;
}
