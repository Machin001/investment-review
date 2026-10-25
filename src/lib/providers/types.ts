/**
 * 数据源抽象
 *
 * 目标：产品代码只依赖这个接口，不关心背后是扶摇 REST、iFinD MCP 还是本地种子数据。
 * 缺凭证时不会假装成功 —— 直接抛 MissingCredentialError，由上层转成界面上的「缺失 + 原因」。
 */

import type { Evidence } from '../types';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly endpoint: string,
    public readonly code?: number | string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class MissingCredentialError extends ProviderError {
  constructor(provider: string, envName: string) {
    super(
      `未配置 ${provider} 凭证（环境变量 ${envName} 缺失），该数据源不可用。` +
        `产品不会用假数据替代，相关证据位将标记为缺失。`,
      provider,
      'auth',
    );
    this.name = 'MissingCredentialError';
  }
}

export interface DailyBar {
  dateMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

/** 一次取数结果：证据 + 可追溯信息 + 失败原因 */
export interface FetchResult {
  evidences: Evidence[];
  /** 取数过程中发生的降级/失败，必须透传给界面 */
  gaps: { item: string; reason: string; impact: string }[];
}

export interface MarketDataProvider {
  readonly name: string;
  /** 历史日 K 线（个股） */
  getStockBars(thscode: string, startMs: number, endMs: number): Promise<DailyBar[]>;
  /** 历史日 K 线（指数） */
  getIndexBars(thscode: string, startMs: number, endMs: number): Promise<DailyBar[]>;
  /** 该交易日热榜前 N */
  getHotList(date: string, topN: number): Promise<{ thscode: string; name: string; rank: number }[]>;
  /** 该交易日的龙虎榜记录；未上榜返回 null */
  getDragonTiger(
    date: string,
    thscode: string,
  ): Promise<{ netValue: number; netRate: number; hotRank: number | null; concepts: string[] } | null>;
  /** 该交易日涨停统计（市场情绪） */
  getLimitUpStats(date: string): Promise<{ limitUpCount: number; sealRate: number; openCount: number }>;
  /**
   * 交易日历（`yyyy-MM-dd` 升序）。
   * 交易日间隔计算必须依赖它，不允许用自然日替代。
   */
  getTradingCalendar(startMs: number, endMs: number): Promise<string[]>;
}
