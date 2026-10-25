/**
 * 时点防火墙（Time-Wall）
 *
 * 这是整个产品的核心机制，不是「给事后信息打个标签」，而是让事后信息
 * 在查询与数据流层面根本无法进入「当时的我」这个视图。
 *
 * 判定规则（唯一真源，界面上展示的理由文字都来自这里）：
 *
 *   precision=ms     publishedAt <= cutoff            → visible
 *                    publishedAt >  cutoff            → after
 *   precision=date   cutoff >= 当日 23:59:59.999       → visible（整日已过去）
 *                    cutoff <  当日 00:00              → after
 *                    其余（同为当日）                  → uncertain（分不清盘前盘后）
 *   precision=none                                    → unknown_time
 *
 * 保守原则：拿不准一律不判 visible。无法证明「当时可见」，就不许它参与归因。
 */

import type { Evidence, VisibilityJudgement, VisibilityVerdict } from './types';
import { dayStartMs, dayEndMs, shanghaiDate, shanghaiDateTime } from './time';

/** 判定单条证据相对于某个决策时点是否可见 */
export function judgeVisibility(evidence: Evidence, cutoffMs: number): VisibilityJudgement {
  const { timePrecision, publishedAtMs, publishedDate } = evidence;

  if (timePrecision === 'ms') {
    if (publishedAtMs === null || !Number.isFinite(publishedAtMs)) {
      return {
        verdict: 'unknown_time',
        reason: '标记为毫秒精度，但缺少发布时间字段，按不可见处理',
        countable: false,
      };
    }
    if (publishedAtMs <= cutoffMs) {
      return {
        verdict: 'visible',
        reason: `发布于 ${shanghaiDateTime(publishedAtMs)}，早于决策时点 ${shanghaiDateTime(cutoffMs)}`,
        countable: true,
      };
    }
    return {
      verdict: 'after',
      reason: `发布于 ${shanghaiDateTime(publishedAtMs)}，晚于决策时点 ${shanghaiDateTime(cutoffMs)}，属于事后信息`,
      countable: false,
    };
  }

  if (timePrecision === 'date') {
    if (!publishedDate) {
      return {
        verdict: 'unknown_time',
        reason: '标记为日期精度，但缺少日期字段，按不可见处理',
        countable: false,
      };
    }
    const start = dayStartMs(publishedDate);
    const end = dayEndMs(publishedDate);

    if (cutoffMs >= end) {
      return {
        verdict: 'visible',
        reason: `${publishedDate} 全天已过去，可视为当时可见`,
        countable: true,
      };
    }
    if (cutoffMs < start) {
      return {
        verdict: 'after',
        reason: `发生在 ${publishedDate}，晚于决策时点 ${shanghaiDate(cutoffMs)}，属于事后信息`,
        countable: false,
      };
    }
    return {
      verdict: 'uncertain',
      reason: `与决策同一天（${publishedDate}），但数据源只提供日期、无具体发布时间，无法判断盘前还是盘后`,
      countable: false,
    };
  }

  return {
    verdict: 'unknown_time',
    reason: '数据源未提供任何时间信息，无法判断当时是否可见',
    countable: false,
  };
}

export interface PartitionResult {
  /** 当时可见：唯一允许进入「当时的我」视图的集合 */
  visible: Evidence[];
  /** 决策之后才公开：进入后视镜区，默认折叠 */
  after: Evidence[];
  /** 同日但分不清盘前盘后：折叠展示，不计权重 */
  uncertain: Evidence[];
  /** 无时间信息：单独列出，要求用户确认 */
  unknownTime: Evidence[];
  /** 每条的判定结果，便于界面逐条展示理由 */
  judgements: Map<string, VisibilityJudgement>;
}

/** 按决策时点把一组证据切成四类 */
export function partitionByCutoff(evidences: Evidence[], cutoffMs: number): PartitionResult {
  const result: PartitionResult = {
    visible: [],
    after: [],
    uncertain: [],
    unknownTime: [],
    judgements: new Map(),
  };

  for (const e of evidences) {
    const j = judgeVisibility(e, cutoffMs);
    result.judgements.set(e.id, j);
    switch (j.verdict) {
      case 'visible':
        result.visible.push(e);
        break;
      case 'after':
        result.after.push(e);
        break;
      case 'uncertain':
        result.uncertain.push(e);
        break;
      default:
        result.unknownTime.push(e);
    }
  }

  return result;
}

export class TimeWallViolation extends Error {
  constructor(public readonly offenders: { id: string; verdict: VisibilityVerdict; reason: string }[]) {
    super(
      `时点防火墙拦截：有 ${offenders.length} 条证据不属于「当时可见」，不允许进入当时视图。` +
        `第一条：${offenders[0]?.id}（${offenders[0]?.verdict}）`,
    );
    this.name = 'TimeWallViolation';
  }
}

/**
 * 运行时护栏 —— 在视图组装完成的最后一步复查。
 *
 * 过滤函数可能被绕开（拼装逻辑写错、缓存穿透、手动注入），所以出口处再断言一次：
 * 只要混进了非 visible 的证据，直接抛错而不是静默渲染。
 */
export function guardNoFutureLeak(evidences: Evidence[], cutoffMs: number): void {
  const offenders = evidences
    .map((e) => ({ e, j: judgeVisibility(e, cutoffMs) }))
    .filter(({ j }) => j.verdict !== 'visible')
    .map(({ e, j }) => ({ id: e.id, verdict: j.verdict, reason: j.reason }));

  if (offenders.length > 0) {
    throw new TimeWallViolation(offenders);
  }
}

/** 只有 visible 的 A/B 级证据参与归因权重计算 */
export function isCountable(evidence: Evidence, cutoffMs: number): boolean {
  const j = judgeVisibility(evidence, cutoffMs);
  return j.verdict === 'visible' && evidence.level !== 'C';
}

/**
 * 数据完整度：可见的市场证据中，A 级（可精确校验）占比。
 * 用于给复盘结论打置信度，而不是拍脑袋写「高置信」。
 *
 * 系统说明（type='user_note'）不计入分母 —— 它记录的是「这里没有数据」这件事本身，
 * 不是市场信息，算进去反而会稀释可信度指标。
 */
export function dataCompleteness(evidences: Evidence[], cutoffMs: number): number {
  const visible = evidences.filter(
    (e) => e.type !== 'user_note' && judgeVisibility(e, cutoffMs).verdict === 'visible',
  );
  if (visible.length === 0) return 0;
  const aLevel = visible.filter((e) => e.level === 'A').length;
  return Number((aLevel / visible.length).toFixed(4));
}
