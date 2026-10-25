import { describe, it, expect } from 'vitest';
import {
  tradingDayGap,
  calendarDayGapBetween,
  isTradingDay,
  CalendarCoverageError,
  parseDateTime,
  dayCloseMs,
  shanghaiDate,
} from '@/lib/time';

/** 一份手写日历，刻意排除周末与中秋/国庆假期，用于验证口径而不是验证接口 */
const CAL = [
  '2026-09-24', // 四
  '2026-09-25', // 五
  '2026-09-28', // 一
  '2026-09-29', // 二
  '2026-09-30', // 三
  // 10-01 ~ 10-08 国庆休市
  '2026-10-09', // 五
  '2026-10-12', // 一
  '2026-10-13', // 二
];

describe('交易日历口径 · 交易日间隔', () => {
  it('同日买卖 → 0 个交易日', () => {
    const t = parseDateTime('2026-09-25 10:00');
    expect(tradingDayGap(t, parseDateTime('2026-09-25 14:30'), CAL)).toBe(0);
  });

  it('周五买入、周一卖出 → 1 个交易日（不是 3 个自然日）', () => {
    const buy = parseDateTime('2026-09-25 10:00');
    const sell = parseDateTime('2026-09-28 10:00');
    expect(tradingDayGap(buy, sell, CAL)).toBe(1);
    expect(calendarDayGapBetween(buy, sell)).toBe(3);
  });

  it('跨国庆长假：9-30 买入、10-09 卖出 → 1 个交易日，自然日却是 9 天', () => {
    const buy = parseDateTime('2026-09-30 10:00');
    const sell = parseDateTime('2026-10-09 10:00');
    expect(tradingDayGap(buy, sell, CAL)).toBe(1);
    expect(calendarDayGapBetween(buy, sell)).toBe(9);
  });

  it('区间内的交易日全部计入：9-24 → 10-13 共 7 个', () => {
    const buy = parseDateTime('2026-09-24 10:00');
    const sell = parseDateTime('2026-10-13 10:00');
    expect(tradingDayGap(buy, sell, CAL)).toBe(7);
  });

  it('日历覆盖不到区间 → 抛 CalendarCoverageError，不回退自然日', () => {
    const buy = parseDateTime('2026-01-05 10:00');
    const sell = parseDateTime('2026-02-05 10:00');
    expect(() => tradingDayGap(buy, sell, CAL)).toThrow(CalendarCoverageError);
    try {
      tradingDayGap(buy, sell, CAL);
    } catch (err) {
      const e = err as CalendarCoverageError;
      expect(e.calendarRange).toEqual(['2026-09-24', '2026-10-13']);
      expect(e.message).toContain('拒绝用自然日替代');
    }
  });

  it('空日历 → 抛错而不是返回 0', () => {
    expect(() => tradingDayGap(parseDateTime('2026-09-25 10:00'), parseDateTime('2026-09-28 10:00'), [])).toThrow(
      CalendarCoverageError,
    );
  });

  it('终点早于起点 → 抛错', () => {
    expect(() => tradingDayGap(parseDateTime('2026-09-28 10:00'), parseDateTime('2026-09-25 10:00'), CAL)).toThrow();
  });

  it('isTradingDay 按日历判定', () => {
    expect(isTradingDay('2026-10-01', CAL)).toBe(false);
    expect(isTradingDay('2026-10-09', CAL)).toBe(true);
  });
});

describe('自然日差仅用于展示', () => {
  it('相邻自然日恒为 1', () => {
    expect(calendarDayGapBetween(parseDateTime('2026-09-30 10:00'), parseDateTime('2026-10-01 10:00'))).toBe(1);
  });
});

describe('收盘时点', () => {
  it('dayCloseMs 落在当日东八区 15:00', () => {
    const ms = dayCloseMs('2026-08-03');
    expect(shanghaiDate(ms)).toBe('2026-08-03');
    expect(new Date(ms + 8 * 3600_000).toISOString().slice(11, 16)).toBe('15:00');
  });
});
