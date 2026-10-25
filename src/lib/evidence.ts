/**
 * 证据层的通用加工：冲突检测、假设可信锚判定、缺口登记
 *
 * 设计原则：这里的每个判断都必须可复现、可解释，不依赖模型。
 */

import type { Evidence, HypothesisAnchor } from './types';

/**
 * 跨源冲突检测
 *
 * 只在「同一指标 + 同一日期 + 同一标的」的证据之间比对数值。
 * 依据是 evidence.metric，不用正则从摘要里猜数。
 *
 * 处理方式：**双方都保留，互指 conflictWith**，绝不静默取其一。
 * 界面据此渲染「两源不一致」标记，把判断权交给用户。
 */
export function detectConflicts(evidences: Evidence[], tolerance = 1e-6): Evidence[] {
  const groups = new Map<string, Evidence[]>();

  for (const e of evidences) {
    if (!e.metric) continue;
    if (e.publishedDate === null) continue;
    const key = `${e.metric.key}|${e.publishedDate}|${e.symbol ?? 'MARKET'}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const av = a.metric!.value;
        const bv = b.metric!.value;
        const diff = Math.abs(av - bv);
        const scale = Math.max(Math.abs(av), Math.abs(bv), 1);
        if (diff / scale <= tolerance) continue;

        a.conflictWith = Array.from(new Set([...(a.conflictWith ?? []), b.id]));
        b.conflictWith = Array.from(new Set([...(b.conflictWith ?? []), a.id]));
      }
    }
  }

  return evidences;
}

export interface ConflictSummary {
  id: string;
  metricKey: string;
  date: string;
  symbol: string;
  values: { evidenceId: string; value: number; source: string }[];
}

/** 把冲突整理成可直接渲染的摘要 */
export function summarizeConflicts(evidences: Evidence[]): ConflictSummary[] {
  const seen = new Set<string>();
  const out: ConflictSummary[] = [];

  for (const e of evidences) {
    if (!e.conflictWith?.length || !e.metric || !e.publishedDate) continue;
    const groupKey = `${e.metric.key}|${e.publishedDate}|${e.symbol ?? 'MARKET'}`;
    if (seen.has(groupKey)) continue;
    seen.add(groupKey);

    const ids = new Set([e.id, ...e.conflictWith]);
    const members = evidences.filter((x) => ids.has(x.id) && x.metric);
    out.push({
      id: groupKey,
      metricKey: e.metric.key,
      date: e.publishedDate,
      symbol: e.symbol ?? 'MARKET',
      values: members.map((m) => ({
        evidenceId: m.id,
        value: m.metric!.value,
        source: m.source.endpoint,
      })),
    });
  }

  return out;
}

/**
 * 假设可信锚判定
 *
 * 复盘场景下「当时怎么想的」几乎必然是事后补写，所以不能只靠录入时间。
 * 三个档位：
 *   contemporaneous  录入时刻不晚于决策时点 + 24h 缓冲（确实是当时/当晚写的）
 *   evidence_backed  事后补写，但触发条件能与当时可见的 A/B 级证据交叉印证
 *   recall_only      纯回忆
 *
 * 只有前两档可以参与归因权重；recall_only 与 C 级证据同等对待。
 */
export function classifyHypothesisAnchor(opts: {
  createdAtMs: number;
  decisionAtMs: number;
  /** 触发条件是否被当时可见证据印证（由调用方交叉比对后传入） */
  crossChecked: boolean;
  /** 缓冲窗口，默认 24 小时 */
  bufferMs?: number;
}): HypothesisAnchor {
  const buffer = opts.bufferMs ?? 24 * 3600_000;
  if (opts.createdAtMs <= opts.decisionAtMs + buffer) return 'contemporaneous';
  return opts.crossChecked ? 'evidence_backed' : 'recall_only';
}

/** 假设是否可计入归因权重 */
export function isHypothesisCountable(anchor: HypothesisAnchor): boolean {
  return anchor !== 'recall_only';
}

/** 缺口登记项 —— 所有缺失都必须走这里，不允许静默 */
export interface Gap {
  item: string;
  reason: string;
  impact: string;
}

export function gapOf(item: string, reason: string, impact: string): Gap {
  return { item, reason, impact };
}
