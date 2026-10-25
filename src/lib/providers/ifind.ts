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

import { MissingCredentialError, ProviderError } from './types';
import type { Evidence } from '../types';

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
  return list
    .filter((r) => r && r.日期)
    .map((r, i) => {
      const date = String(r.日期);
      return {
        id: `ifind:notice:${date}:${i}`,
        type: 'notice' as const,
        level: 'B' as const,
        title: String(r.公告标题 ?? '公告'),
        summary: String(r.公告片段内容 ?? '').replace(/\s+/g, ' ').slice(0, 160),
        symbol: opts.symbol,
        publishedAtMs: null,
        publishedDate: date,
        timePrecision: 'date' as const,
        source: {
          provider: 'ifind' as const,
          endpoint: 'ifind:news.search_notice',
          fetchedAtMs: Date.now(),
          caliber: '语义检索返回公告片段，非全文；仅到日期粒度',
        },
        raw: r as unknown as Record<string, unknown>,
      };
    });
}

/** 板块区间涨跌幅，用于行业超额归因 */
export async function getSectorReturn(sectorQuery: string, start: string, end: string): Promise<number | null> {
  const res = await callTool<{ answer?: string }>('index', 'sector_data', {
    query: `${sectorQuery} ${start} 至 ${end} 区间涨跌幅`,
  });
  const text = res?.answer ?? '';
  const m = /(-?\d+(?:\.\d+)?)\s*\|?\s*$/m.exec(text.split('\n').filter(Boolean).pop() ?? '');
  return m ? Number(m[1]) : null;
}
