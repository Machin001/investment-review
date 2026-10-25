/**
 * iFinD MCP 客户端
 *
 * 直接在服务端说 MCP 协议（JSON-RPC over HTTP），不依赖本机安装的技能包，
 * 这样仓库是自包含的、部署到任何 Node 环境都能跑。
 *
 * 协议要点（与官方 call-node.js 一致）：
 *   1. POST initialize → 从响应头取 Mcp-Session-Id
 *   2. POST notifications/initialized
 *   3. POST tools/call，后续请求带 Mcp-Session-Id
 *
 * 返回体是 SSE 或 JSON 两种形态，这里都兼容。
 * 内层 data 往往是被序列化过的字符串，需要二次解析 —— 这是最容易踩的坑。
 */

import { createHash } from 'node:crypto';
import { MissingCredentialError, ProviderError } from './types';
import type { Evidence } from '../types';
import { dayCloseMs } from '../time';

const BASE = 'https://api-mcp.51ifind.com:8643/ds-mcp-servers';
const TIMEOUT_MS = 45_000;

const SERVERS = {
  stock: `${BASE}/hexin-ifind-ds-stock-mcp`,
  news: `${BASE}/hexin-ifind-ds-news-mcp`,
  index: `${BASE}/hexin-ifind-ds-index-mcp`,
} as const;

type ServerName = keyof typeof SERVERS;

const sessions = new Map<ServerName, string>();

function token(): string {
  const t = process.env.IFIND_AUTH_TOKEN?.trim();
  if (!t) throw new MissingCredentialError('iFinD', 'IFIND_AUTH_TOKEN');
  return t;
}

interface RpcEnvelope {
  result?: { content?: { type: string; text: string }[]; tools?: { name: string }[] };
  error?: { code: number; message: string };
}

function parseBody(text: string): RpcEnvelope {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as RpcEnvelope;
  // SSE：取最后一个 data: 行
  const lines = trimmed.split(/\r?\n/).filter((l) => l.startsWith('data:'));
  for (let i = lines.length - 1; i >= 0; i--) {
    const payload = lines[i].slice(5).trim();
    if (payload && payload !== '[DONE]') {
      try {
        return JSON.parse(payload) as RpcEnvelope;
      } catch {
        /* 继续往前找 */
      }
    }
  }
  throw new Error('无法解析 MCP 响应体');
}

async function post(server: ServerName, payload: unknown): Promise<{ res: Response; body: RpcEnvelope }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: token(),
  };
  const sid = sessions.get(server);
  if (sid) headers['Mcp-Session-Id'] = sid;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(SERVERS[server], {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    return { res, body: parseBody(text) };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ProviderError(`iFinD 请求超时（${TIMEOUT_MS / 1000}s）`, 'ifind', server);
    }
    throw new ProviderError(`iFinD 网络错误：${(err as Error).message}`, 'ifind', server);
  } finally {
    clearTimeout(timer);
  }
}

async function ensureSession(server: ServerName): Promise<void> {
  if (sessions.has(server)) return;
  const { res, body } = await post(server, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'panfu', version: '0.1.0' } },
  });
  if (res.status >= 400 || body.error) {
    throw new ProviderError(`iFinD 会话初始化失败：HTTP ${res.status}`, 'ifind', server);
  }
  const sid = res.headers.get('mcp-session-id');
  if (!sid) throw new ProviderError('iFinD 未返回 Mcp-Session-Id', 'ifind', server);
  sessions.set(server, sid);
  await post(server, { jsonrpc: '2.0', method: 'notifications/initialized' });
}

/** 调用一个工具，返回内层已解析的数据 */
export async function callTool<T = unknown>(server: ServerName, tool: string, args: Record<string, unknown>): Promise<T> {
  await ensureSession(server);
  const { res, body } = await post(server, {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: tool, arguments: args },
  });

  if (body.error) throw new ProviderError(`iFinD 工具错误：${body.error.message}`, 'ifind', tool, body.error.code);
  if (res.status >= 400) throw new ProviderError(`iFinD HTTP ${res.status}`, 'ifind', tool);

  const raw = body.result?.content?.find((c) => c.type === 'text')?.text;
  if (!raw) throw new ProviderError('iFinD 返回为空', 'ifind', tool);

  const outer = JSON.parse(raw) as { code: number; msg: string; data: unknown };
  if (outer.code !== 1 && outer.code !== 0) {
    throw new ProviderError(`iFinD 业务错误 code=${outer.code}: ${outer.msg}`, 'ifind', tool, outer.code);
  }

  // 内层 data 常是被再度序列化的字符串
  if (typeof outer.data === 'string') {
    try {
      return JSON.parse(outer.data) as T;
    } catch {
      return outer.data as unknown as T;
    }
  }
  return outer.data as T;
}

interface RawNotice {
  公告标题?: string;
  公告片段内容?: string;
  日期?: string;
}

/** 内容寻址 id：同一条公告无论检索多少次，id 恒定 */
export function noticeId(date: string, title: string): string {
  const digest = createHash('sha1').update(`${date}|${title}`).digest('hex').slice(0, 10);
  return `ifind:notice:${date}:${digest}`;
}

export interface SectorEvidenceResult {
  evidence: Evidence;
  /** 从原文解析出的数值；解析失败为 null，绝不置 0 */
  value: number | null;
  gap?: { item: string; reason: string; impact: string };
}

/**
 * 公告检索 → 证据
 *
 * 注意：iFinD 只返回到「日期」粒度，没有精确发布时间。
 * 因此一律标 B 级 + date 精度，由时点防火墙判定；与决策同日时会被判为 uncertain。
 */
export async function searchNotices(
  query: string,
  opts: { timeStart: string; timeEnd: string; size?: number; symbol?: string },
): Promise<Evidence[]> {
  const rows = await callTool<RawNotice[]>('news', 'search_notice', {
    query,
    time_start: opts.timeStart,
    time_end: opts.timeEnd,
    size: opts.size ?? 5,
  });

  const list = Array.isArray(rows) ? rows : [];
  const byId = new Map<string, Evidence>();

  for (const r of list) {
    if (!r || !r.日期) continue;
    const date = String(r.日期);
    const title = String(r.公告标题 ?? '公告');
    let id = noticeId(date, title);

    // 同日同标题理论上罕见；出现时保留两条并互指冲突，而不是覆盖
    if (byId.has(id)) {
      const existing = byId.get(id)!;
      let n = 2;
      let candidate = `${id}-${n}`;
      while (byId.has(candidate)) candidate = `${id}-${++n}`;
      existing.conflictWith = [...(existing.conflictWith ?? []), candidate];
      byId.set(existing.id, existing);
      id = candidate;
    }

    const ev: Evidence = {
      id,
      type: 'notice',
      level: 'B',
      title,
      summary: String(r.公告片段内容 ?? '').replace(/\s+/g, ' ').slice(0, 160),
      symbol: opts.symbol,
      publishedAtMs: null,
      publishedDate: date,
      timePrecision: 'date',
      source: {
        provider: 'ifind',
        endpoint: 'ifind:news.search_notice',
        fetchedAtMs: Date.now(),
        caliber: '语义检索返回公告片段，非全文；仅到日期粒度，无精确发布时间',
      },
      raw: r as unknown as Record<string, unknown>,
    };

    if (id !== noticeId(date, title)) {
      ev.conflictWith = [noticeId(date, title)];
    }
    byId.set(id, ev);
  }

  return [...byId.values()];
}

/**
 * 板块区间涨跌幅 → 证据 + 数值
 *
 * 溯源要求：返回的是 Evidence（含 raw 原文全文、来源、口径），而不是裸数字。
 * 解析失败时 value=null 并返回 gap，由调用方登记为显式缺口，绝不猜数、不置 0。
 *
 * 时点口径：区间涨跌幅在区间结束日收盘后才可算出，故 publishedAt 记为 end 日 15:00，
 * 相对建仓时点属于事后信息 —— 它本来就只能在复盘时使用。
 */
export async function getSectorEvidence(
  sectorQuery: string,
  start: string,
  end: string,
): Promise<SectorEvidenceResult> {
  const res = await callTool<{ answer?: string; indicators_params?: Record<string, unknown> }>(
    'index',
    'sector_data',
    { query: `${sectorQuery} ${start} 至 ${end} 区间涨跌幅` },
  );

  const answer = res?.answer ?? '';
  const rows = answer
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && !/^\|[\s\-:|]+\|$/.test(l));

  let value: number | null = null;
  // 取表格数据行的最后一列数值
  for (let i = rows.length - 1; i >= 0; i--) {
    const cells = rows[i].split('|').map((c) => c.trim()).filter(Boolean);
    const last = cells[cells.length - 1];
    if (last && /^-?\d+(?:\.\d+)?$/.test(last)) {
      value = Number(last);
      break;
    }
  }

  const evidence: Evidence = {
    id: `ifind:sector:${createHash('sha1').update(`${sectorQuery}|${start}|${end}`).digest('hex').slice(0, 10)}`,
    type: 'sector',
    level: 'B',
    title: `${sectorQuery} 区间涨跌幅 ${start}~${end}`,
    summary: value === null ? `未能从返回原文解析出数值（原文已保留）` : `${value.toFixed(2)}%（口径见原文）`,
    publishedAtMs: dayCloseMs(end),
    publishedDate: end,
    timePrecision: 'ms',
    source: {
      provider: 'ifind',
      endpoint: 'ifind:index.sector_data',
      fetchedAtMs: Date.now(),
      caliber: '区间涨跌幅，口径以 iFinD 返回原文为准（可能为总市值加权平均等不同口径）',
    },
    raw: { answer, indicators_params: res?.indicators_params ?? null },
  };

  if (value === null) {
    return {
      evidence,
      value: null,
      gap: {
        item: '行业超额归因',
        reason: 'iFinD 返回的是表格文本，未能解析出区间涨跌幅数值',
        impact: 'sectorPct 项无法计算，归因面板该项显示为缺失并降低整体置信度',
      },
    };
  }

  return { evidence, value };
}
