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
import { dayStartMs } from '../time';

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
};

/** 单根日 K 线 → 证据：收盘价在当日 15:00 确定，属 A 级毫秒精度 */
export function barToEvidence(
  bar: DailyBar,
  opts: { thscode: string; name: string; kind: 'price' | 'index' },
): import('../types').Evidence {
  const date = new Date(bar.dateMs + 8 * 3600_000).toISOString().slice(0, 10);
  const atMs = dayStartMs(date) + 15 * 3600_000;
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
      caliber: '日线·前复权（指数无复权）',
    },
    raw: bar as unknown as Record<string, unknown>,
  };
}
