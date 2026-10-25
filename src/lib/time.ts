/**
 * 时间工具 · 统一按 Asia/Shanghai 语义处理
 *
 * 所有毫秒时间戳都是绝对时刻（UTC 毫秒），只是展示与「按日切片」时按东八区切。
 * 不依赖运行环境的本地时区，避免部署到 UTC 机器后日期错位。
 *
 * 口径纪律（重要）：
 *   - 自然日差与交易日差是两个不同的东西，绝不互相替代。
 *   - 需要交易日间隔时必须传交易日历；日历覆盖不到区间就抛错，不允许静默回退自然日。
 */

const HOUR = 3600_000;
const SHANGHAI_OFFSET = 8 * HOUR;

/** 日历无法覆盖所请求区间时抛出 —— 调用方必须转成显式缺口，不得静默降级 */
export class CalendarCoverageError extends Error {
  constructor(
    message: string,
    public readonly fromDate: string,
    public readonly toDate: string,
    public readonly calendarRange: [string, string] | null,
  ) {
    super(message);
    this.name = 'CalendarCoverageError';
  }
}

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

/** 该日东八区 15:00（A 股收盘，日 K 收盘价确定时点） */
export function dayCloseMs(date: string): number {
  return dayStartMs(date) + 15 * HOUR;
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
    return dayCloseMs(dateOnly[1]);
  }
  throw new Error(`无法解析时间：${input}`);
}

/**
 * 自然日差 —— 口径=自然日，仅供展示（如「持有 12 个自然日」）。
 * 不得用于任何「交易日」语义的判断。
 */
export function calendarDayGapBetween(fromMs: number, toMs: number): number {
  const a = dayStartMs(shanghaiDate(fromMs));
  const b = dayStartMs(shanghaiDate(toMs));
  return Math.round((b - a) / (24 * HOUR));
}

/**
 * 交易日间隔 —— 口径=交易日，必须传交易日历。
 *
 * 定义为「起点日之后、终点日（含）之间的交易日个数」：
 *   周五买入、周一卖出 → 1（只有周一一个交易日）
 *   同一天 → 0
 *
 * 日历覆盖不到区间时抛 CalendarCoverageError，绝不回退自然日。
 */
export function tradingDayGap(fromMs: number, toMs: number, calendar: string[]): number {
  const fromDate = shanghaiDate(fromMs);
  const toDate = shanghaiDate(toMs);

  if (fromDate === toDate) return 0;
  if (toDate < fromDate) {
    throw new Error(`终点早于起点：${toDate} < ${fromDate}`);
  }

  const sorted = [...calendar].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (!first || !last || first > fromDate || last < toDate) {
    throw new CalendarCoverageError(
      `交易日历无法覆盖 ${fromDate} ~ ${toDate}（日历范围 ${first ?? '空'} ~ ${last ?? '空'}），` +
        `拒绝用自然日替代交易日计算。`,
      fromDate,
      toDate,
      first && last ? [first, last] : null,
    );
  }

  let count = 0;
  for (const d of sorted) {
    if (d > fromDate && d <= toDate) count += 1;
  }
  return count;
}

/** 判断某个日期是否为交易日（日历须覆盖该日） */
export function isTradingDay(date: string, calendar: string[]): boolean {
  return calendar.includes(date);
}
