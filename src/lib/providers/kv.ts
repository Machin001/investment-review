/**
 * 数据源缓存 / 快照层
 *
 * 解决的问题：部署环境没有 API Key（而且按安全要求，Key 不该被上传），
 * 但产品必须能展示真实数据，不能满屏报错。
 *
 * 三种模式：
 *   live      实时调用上游（本地开发，有凭证）
 *   record    实时调用并把响应记录下来，用于生成快照
 *   snapshot  只读本地快照，命中不了的请求**显式报错**，由上层转成 gaps
 *
 * 模式选择：
 *   DATA_MODE=live / snapshot 显式指定；
 *   DATA_RECORD=1 进入录制；
 *   都不设时自动判断 —— 有凭证走 live，没凭证走 snapshot。
 *
 * 红线：快照里没有的请求绝不返回假数据，一律抛 SnapshotMiss，界面显示为缺口。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export type ProviderMode = 'live' | 'record' | 'snapshot';

const SNAPSHOT_FILE = path.join(process.cwd(), 'src', 'data', 'snapshot', 'providers.json');

export class SnapshotMiss extends Error {
  constructor(public readonly key: string) {
    super(
      `快照中缺少该请求（${key}）。当前运行在数据快照模式，不会用假数据替代；` +
        `如需完整数据请在本地以 live 模式运行。`,
    );
    this.name = 'SnapshotMiss';
  }
}

let snapshotCache: Record<string, unknown> | null = null;
let recording: Record<string, unknown> | null = null;

function hasCredentials(): boolean {
  return Boolean(process.env.FUYAO_API_KEY?.trim() || process.env.IFIND_AUTH_TOKEN?.trim());
}

export function getMode(): ProviderMode {
  if (process.env.DATA_RECORD === '1') return 'record';
  const explicit = process.env.DATA_MODE?.trim();
  if (explicit === 'live' || explicit === 'snapshot' || explicit === 'record') return explicit;
  return hasCredentials() ? 'live' : 'snapshot';
}

export function isSnapshotMode(): boolean {
  return getMode() === 'snapshot';
}

async function loadSnapshot(): Promise<Record<string, unknown>> {
  if (snapshotCache) return snapshotCache;
  try {
    const raw = await fs.readFile(SNAPSHOT_FILE, 'utf8');
    snapshotCache = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    snapshotCache = {};
  }
  return snapshotCache!;
}

/**
 * 把参数稳定序列化，保证「同一次请求」的 key 可复现。
 *
 * 关键点：毫秒时间戳必须按东八区自然日归一。
 * 否则录制与回放只要相差几秒，`end=Date.now()` 就会算出不同的 key，
 * 快照全部 miss —— 数据是同一份，key 却对不上。
 */
function stableKey(parts: (string | number | undefined | object)[]): string {
  const norm = (v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    // 日线/日历类接口的时间参数只精确到天，按天归一是安全的
    if (typeof v === 'number' && v > 1e11) {
      return `D${Math.floor((v + 8 * 3600_000) / 86_400_000)}`;
    }
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, val]) => val !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, norm(val)]),
      );
    }
    return v;
  };
  return parts.map((p) => JSON.stringify(norm(p))).join('::');
}

export function cacheKey(provider: string, endpoint: string, params: unknown): string {
  return `${provider}|${endpoint}|${stableKey([params as object])}`;
}

/** 统一的取数入口：按模式决定实时调用、录制还是读快照 */
export async function cachedCall<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const mode = getMode();

  if (mode === 'snapshot') {
    const snap = await loadSnapshot();
    if (!(key in snap)) throw new SnapshotMiss(key);
    return snap[key] as T;
  }

  const value = await fetcher();
  if (mode === 'record') {
    recording ??= {};
    recording[key] = value;
  }
  return value;
}

export function startRecording(): void {
  recording = {};
}

export function dumpRecording(): { count: number; data: Record<string, unknown> } {
  return { count: Object.keys(recording ?? {}).length, data: recording ?? {} };
}

export function snapshotPath(): string {
  return SNAPSHOT_FILE;
}

/** 快照的录制时间（用于界面标注「数据截至」） */
export async function snapshotRecordedAt(): Promise<number | null> {
  const snap = await loadSnapshot();
  const meta = snap['__meta'] as { recordedAtMs?: number } | undefined;
  return typeof meta?.recordedAtMs === 'number' ? meta.recordedAtMs : null;
}
