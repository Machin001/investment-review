/**
 * 交割单 CSV / TSV 解析
 *
 * 券商导出的交割单格式五花八门，这里用「列名别名 + 手工映射 + 逐行校验」的做法：
 * 解析失败的行走 errors 返回给用户核对，绝不猜测或跳过。
 */

import type { Trade } from './types';
import { parseDateTime } from './time';

export interface ParseResult {
  trades: Trade[];
  errors: string[];
  /** 识别到的列 → 原始列名，用于界面回显「我是怎么理解你的表的」 */
  mapping: Record<string, string>;
}

const ALIASES: Record<string, string[]> = {
  tradedAt: ['成交时间', '成交日期', '发生日期', '交易日期', '日期'],
  time: ['成交时间', '委托时间'],
  thscode: ['证券代码', '股票代码', '代码'],
  name: ['证券名称', '股票名称', '名称'],
  side: ['买卖标志', '操作', '业务名称', '买卖方向', '摘要'],
  price: ['成交价格', '成交均价', '价格', '成交价'],
  qty: ['成交数量', '成交股数', '数量'],
  amount: ['成交金额', '金额', '发生金额'],
  fee: ['手续费', '佣金', '费用合计', '总费用'],
};

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter !== ',') return line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function detectDelimiter(headerLine: string): string {
  const candidates = ['\t', ',', ';'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = headerLine.split(d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** 从证券代码推断交易所后缀 */
function toThscode(code: string): string | null {
  const c = code.replace(/[^0-9]/g, '');
  if (c.length !== 6) return null;
  if (/^(60|68|90|11|13)/.test(c)) return `${c}.SH`;
  if (/^(00|30|20|12)/.test(c)) return `${c}.SZ`;
  if (/^(8|4|92)/.test(c)) return `${c}.BJ`;
  return null;
}

export function parseTradeCsv(text: string): ParseResult {
  const errors: string[] = [];
  const mapping: Record<string, string> = {};
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { trades: [], errors: ['内容不足两行，无法解析出表头与数据'], mapping };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter).map((h) => h.replace(/\s/g, ''));

  const pick = (field: string): number => {
    for (const alias of ALIASES[field] ?? []) {
      const idx = headers.findIndex((h) => h === alias || h.includes(alias));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const idx = {
    tradedAt: pick('tradedAt'),
    thscode: pick('thscode'),
    name: pick('name'),
    side: pick('side'),
    price: pick('price'),
    qty: pick('qty'),
    amount: pick('amount'),
    fee: pick('fee'),
  };

  for (const [k, v] of Object.entries(idx)) {
    if (v >= 0) mapping[k] = headers[v];
  }

  const required: [string, number][] = [
    ['tradedAt', idx.tradedAt],
    ['thscode', idx.thscode],
    ['side', idx.side],
    ['price', idx.price],
    ['qty', idx.qty],
  ];
  const missing = required.filter(([, v]) => v < 0).map(([k]) => k);
  if (missing.length) {
    return {
      trades: [],
      errors: [`未识别到必需列：${missing.join('、')}。表头为：${headers.join(' | ')}`],
      mapping,
    };
  }

  const trades: Trade[] = [];
  const positionCounter = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delimiter);
    const rowNo = i + 1;
    try {
      const rawSide = (cells[idx.side] ?? '').trim();
      const side: 'buy' | 'sell' = /卖|sell/i.test(rawSide) ? 'sell' : /买|buy/i.test(rawSide) ? 'buy' : ('buy' as const);
      if (!/卖|买|sell|buy/i.test(rawSide)) {
        errors.push(`第 ${rowNo} 行：买卖方向「${rawSide}」无法识别，已跳过`);
        continue;
      }

      const thscode = toThscode(cells[idx.thscode] ?? '');
      if (!thscode) {
        errors.push(`第 ${rowNo} 行：证券代码「${cells[idx.thscode] ?? ''}」无法识别，已跳过`);
        continue;
      }

      const price = Number((cells[idx.price] ?? '').replace(/[^\d.\-]/g, ''));
      const qty = Number((cells[idx.qty] ?? '').replace(/[^\d.\-]/g, ''));
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty === 0) {
        errors.push(`第 ${rowNo} 行：价格或数量非法（${cells[idx.price]} / ${cells[idx.qty]}），已跳过`);
        continue;
      }

      const amountRaw = idx.amount >= 0 ? Number((cells[idx.amount] ?? '').replace(/[^\d.\-]/g, '')) : NaN;
      const feeRaw = idx.fee >= 0 ? Number((cells[idx.fee] ?? '').replace(/[^\d.\-]/g, '')) : NaN;
      const dateText = (cells[idx.tradedAt] ?? '').replace(/\//g, '-').trim();
      const tradedAtMs = parseDateTime(/^\d{4}-\d{2}-\d{2}/.test(dateText) ? dateText : `${dateText}`);

      const key = `${thscode}`;
      const n = (positionCounter.get(key) ?? 0) + (side === 'buy' ? 1 : 0);
      if (side === 'buy') positionCounter.set(key, n);

      trades.push({
        id: `csv-${rowNo}-${thscode}-${side}`,
        thscode,
        name: (cells[idx.name] ?? '').trim() || thscode,
        side,
        tradedAtMs,
        price,
        qty: Math.abs(qty),
        amount: Number.isFinite(amountRaw) ? Math.abs(amountRaw) : price * Math.abs(qty),
        fee: Number.isFinite(feeRaw) ? Math.abs(feeRaw) : 0,
        positionId: `${key}-${n || 1}`,
        entrySource: 'csv',
      });
    } catch (err) {
      errors.push(`第 ${rowNo} 行：${(err as Error).message}`);
    }
  }

  return { trades, errors, mapping };
}
