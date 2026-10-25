/**
 * 时间工具 · 统一按 Asia/Shanghai 语义处理
 *
 * 所有毫秒时间戳都是绝对时刻（UTC 毫秒），只是展示与「按日切片」时按东八区切。
 * 不依赖运行环境的本地时区，避免部署到 UTC 机器后日期错位。
 */

const HOUR = 3600_000;
const SHANGHAI_OFFSET = 8 * HOUR;

/** 把绝对时刻拆成东八区的年月日与时分 */
export function shanghaiParts(ms: number): {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
} {
  const dt = new Date(ms + SHANGHAI_OFFSET);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    hh: dt.getUTCHours(),
    mm: dt.getUTCMinutes(),
    ss: dt.getUTCSeconds(),
  };
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** 绝对时刻 → `yyyy-MM-dd`（东八区） */
export function shanghaiDate(ms: number): string {
  const p = shanghaiParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** 绝对时刻 → `yyyy-MM-dd HH:mm`（东八区），用于时间线与证据卡展示 */
export function shanghaiDateTime(ms: number): string {
  const p = shanghaiParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`;
}

/** `yyyy-MM-dd` → 该日东八区 00:00:00.000 的绝对时刻 */
export function dayStartMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`非法日期格式，应为 yyyy-MM-dd：${date}`);
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return utcMidnight - SHANGHAI_OFFSET;
}

/** `yyyy-MM-dd` → 该日东八区 23:59:59.999 的绝对时刻 */
export function dayEndMs(date: string): number {
  return dayStartMs(date) + 24 * HOUR - 1;
}

/** 解析用户输入的成交时间，容忍 `yyyy-MM-dd HH:mm` / `yyyy-MM-dd HH:mm:ss` / `yyyy-MM-dd` */
export function parseDateTime(input: string): number {
  const s = input.trim().replace(/\//g, '-');
  const full = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (full) {
    return dayStartMs(full[1]) + Number(full[2]) * HOUR + Number(full[3]) * 60_000 + Number(full[4] ?? 0) * 1000;
  }
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (dateOnly) {
    // 只给日期时，按当日收盘 15:00 作为决策时点，并在上层提示精度不足
    return dayStartMs(dateOnly[1]) + 15 * HOUR;
  }
  throw new Error(`无法解析时间：${input}`);
}

/** 两个绝对时刻相隔的自然日数（按东八区日期差，不含首日） */
export function tradingDayGapApprox(fromMs: number, toMs: number): number {
  const a = dayStartMs(shanghaiDate(fromMs));
  const b = dayStartMs(shanghaiDate(toMs));
  return Math.round((b - a) / (24 * HOUR));
}
