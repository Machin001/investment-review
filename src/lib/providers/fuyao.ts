/**
 * 扶摇金融数据 API 客户端（REST）
 *
 * 凭证：环境变量 FUYAO_API_KEY，只从环境读，不接受硬编码、不写日志。
 * 契约：所有业务错误 HTTP 200 返回，经响应体 code 字段表达。
 *   code=0    成功
 *   code=1001 缺参数 / 1002 参数格式错 / 1003 区间超限
 *   code=2001 缺或无效 X-api-key / code=2003 无权限
 *   code=4001 限流（应降并发，不要立刻重试）
 */

import { MissingCredentialError, ProviderError } from './types';
import type { DailyBar, MarketDataProvider } from './types';
import type { Evidence } from '../types';
import { shanghaiDate, dayCloseMs } from '../time';

const BASE = 'https://fuyao.aicubes.cn';

interface ApiResponse<T> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

function apiKey(): string {
  const k = process.env.FUYAO_API_KEY?.trim();
  if (!k) throw new MissingCredentialError('扶摇', 'FUYAO_API_KEY');
  return k;
}

async function call<T>(path: string, params: Record<string, string | number> = {}): Promise<{ data: T; requestId?: string }> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: { 'X-api-key': apiKey() },
    // 行情数据变化快，缓存交给上层显式控制，这里不缓存
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new ProviderError(`扶摇 HTTP ${res.status}`, 'fuyao', path);
  }

  const body = (await res.json()) as ApiResponse<T>;
  if (body.code !== 0) {
    const hint =
      body.code === 4001
        ? '（触发限流，应降低并发，不要立即重试）'
        : body.code === 2003
          ? '（API Key 对该能力无权限）'
          : '';
    throw new ProviderError(`扶摇返回 code=${body.code}: ${body.message}${hint}`, 'fuyao', path, body.code);
  }
  return { data: body.data, requestId: body.request_id };
}

interface RawBar {
  date_ms: number;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  turnover: number;
}

function mapBars(items: RawBar[]): DailyBar[] {
  return items.map((b) => ({
    dateMs: b.date_ms,
    open: b.open_price,
    high: b.high_price,
    low: b.low_price,
    close: b.close_price,
    volume: b.volume,
    turnover: b.turnover,
  }));
}

export const fuyao: MarketDataProvider = {
  name: 'fuyao',

  async getStockBars(thscode, startMs, endMs) {
    const { data } = await call<{ item: RawBar[] }>('/api/a-share/prices/historical', {
      thscode,
      interval: '1d',
      start: startMs,
      end: endMs,
      adjust: 'forward',
    });
    return mapBars(data.item ?? []);
  },

  async getIndexBars(thscode, startMs, endMs) {
    // 注意：指数路径前缀是 a-share-index，与个股的 a-share 不同
    const { data } = await call<{ item: RawBar[] }>('/api/a-share-index/prices/historical', {
      thscode,
      interval: '1d',
      start: startMs,
      end: endMs,
    });
    return mapBars(data.item ?? []);
  },

  async getHotList(date, topN) {
    const { data } = await call<{ item: { thscode: string; name: string; rank: number }[] }>(
      '/api/a-share/special-data/hot-stock-list-history',
      { date },
    );
    return (data.item ?? []).slice(0, topN);
  },

  async getDragonTiger(date, thscode) {
    const { data } = await call<{
      trade_date: string;
      stock_items: {
        thscode: string;
        name: string;
        net_value: number;
        net_rate: number;
        hot_rank?: number | null;
        concept_list?: { name: string }[];
      }[];
    }>('/api/a-share/special-data/dragon-tiger-list', { date });

    const hit = (data.stock_items ?? []).find((x) => x.thscode === thscode);
    if (!hit) return null;
    return {
      netValue: hit.net_value,
      netRate: hit.net_rate,
      hotRank: hit.hot_rank ?? null,
      concepts: (hit.concept_list ?? []).map((c) => c.name),
    };
  },

  async getLimitUpStats(date) {
    const { data } = await call<{
      limit_up_stock_count: number;
      seal_rate: number;
      open_stock_count: number;
    }>('/api/a-share/special-data/limit-up-statistics', { date });
    return {
      limitUpCount: data.limit_up_stock_count,
      sealRate: data.seal_rate,
      openCount: data.open_stock_count,
    };
  },

  async getTradingCalendar(startMs, endMs) {
    // 该接口不接受区间参数，固定返回近一年交易日，需客户端按区间过滤
    const { data } = await call<{ item: { date_ms: number; date: string }[] }>(
      '/api/a-share/calendar/trading-days',
    );
    const all = (data.item ?? [])
      .map((it) => `${it.date.slice(0, 4)}-${it.date.slice(4, 6)}-${it.date.slice(6, 8)}`)
      .sort();
    const from = shanghaiDate(startMs);
    const to = shanghaiDate(endMs);
    return all.filter((d) => d >= from && d <= to);
  },
};

/**
 * 扶摇日 K 的 `date_ms` 语义常量
 *
 * 实测（2026-10-25，600519.SH / 000300.SH）：
 *   date_ms = 1785686400000 → UTC 2026-08-02T16:00:00Z → 东八区 2026-08-03 00:00:00
 * 即「当日东八区零点」的绝对时刻，不是收盘时刻，也不是 UTC 零点。
 *
 * 下面用断言把这个假设固定住：若上游语义哪天变了，直接抛错，
 * 而不是让所有 A 级证据的 publishedAtMs 静默偏移 15 小时。
 */
const FUYAO_DATE_MS_IS_SHANGHAI_MIDNIGHT = true;

function fuyaoDateMsToDate(dateMs: number): string {
  if (FUYAO_DATE_MS_IS_SHANGHAI_MIDNIGHT) {
    const shifted = dateMs + 8 * 3600_000;
    if (shifted % (24 * 3600_000) !== 0) {
      throw new ProviderError(
        `扶摇 date_ms 语义校验失败：${dateMs} 不是东八区零点（+8h 后余数 ${shifted % (24 * 3600_000)}ms）。` +
          `上游语义可能已变更，拒绝继续换算，避免证据时点整体偏移。`,
        'fuyao',
        'date_ms-invariant',
      );
    }
  }
  return shanghaiDate(dateMs);
}

/** 单根日 K 线 → 证据：收盘价在当日 15:00 确定，属 A 级毫秒精度 */
export function barToEvidence(
  bar: DailyBar,
  opts: { thscode: string; name: string; kind: 'price' | 'index' },
): Evidence {
  const date = fuyaoDateMsToDate(bar.dateMs);
  const atMs = dayCloseMs(date);
  const chg = ((bar.close - bar.open) / bar.open) * 100;
  return {
    id: `${opts.kind}:${opts.thscode}:${date}`,
    type: opts.kind,
    level: 'A',
    title: `${opts.name} ${date} 日K`,
    summary: `收 ${bar.close.toFixed(2)}（当日 ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%），成交额 ${(bar.turnover / 1e8).toFixed(2)} 亿`,
    symbol: opts.thscode,
    publishedAtMs: atMs,
    publishedDate: date,
    timePrecision: 'ms',
    source: {
      provider: 'fuyao',
      endpoint: opts.kind === 'index' ? 'GET /api/a-share-index/prices/historical' : 'GET /api/a-share/prices/historical',
      fetchedAtMs: Date.now(),
      caliber: '日线·前复权（指数无复权）；date_ms 经断言确认为东八区零点，收盘价按当日 15:00 记为可见时点',
    },
    raw: bar as unknown as Record<string, unknown>,
  };
}
