import { describe, it, expect } from 'vitest';
import type { Evidence, EvidenceLevel, TimePrecision } from '@/lib/types';
import { judgeVisibility, partitionByCutoff, guardNoFutureLeak, TimeWallViolation, isCountable, dataCompleteness } from '@/lib/timewall';
import { parseDateTime, dayEndMs, shanghaiDate } from '@/lib/time';

/** 构造一条证据，默认给足字段，只在用例里覆盖需要变化的 */
function ev(opts: {
  id: string;
  precision: TimePrecision;
  at?: string | null; // yyyy-MM-dd HH:mm
  date?: string | null; // yyyy-MM-dd
  level?: EvidenceLevel;
  title?: string;
}): Evidence {
  return {
    id: opts.id,
    type: 'notice',
    level: opts.level ?? 'A',
    title: opts.title ?? opts.id,
    summary: '',
    publishedAtMs: opts.at ? parseDateTime(opts.at) : null,
    publishedDate: opts.date ?? (opts.at ? shanghaiDate(parseDateTime(opts.at)) : null),
    timePrecision: opts.precision,
    source: { provider: 'fuyao', endpoint: 'test', fetchedAtMs: Date.now() },
  };
}

// 决策时点：2026-08-03 10:23 买入
const T0 = parseDateTime('2026-08-03 10:23');

describe('时点防火墙 · 毫秒精度', () => {
  it('决策前 2 小时发布 → 当时可见', () => {
    const e = ev({ id: 'n1', precision: 'ms', at: '2026-08-03 08:23' });
    const j = judgeVisibility(e, T0);
    expect(j.verdict).toBe('visible');
    expect(j.countable).toBe(true);
  });

  it('决策后 1 小时发布 → 事后信息，必须被拦住', () => {
    const e = ev({ id: 'n2', precision: 'ms', at: '2026-08-03 11:23' });
    const j = judgeVisibility(e, T0);
    expect(j.verdict).toBe('after');
    expect(j.countable).toBe(false);
    expect(j.reason).toContain('事后信息');
  });

  it('边界：发布时间正好等于决策时点 → 视为可见', () => {
    const e = ev({ id: 'n3', precision: 'ms', at: '2026-08-03 10:23' });
    expect(judgeVisibility(e, T0).verdict).toBe('visible');
  });

  it('标记为 ms 精度但字段缺失 → 保守判为 unknown_time，不猜', () => {
    const e = ev({ id: 'n4', precision: 'ms', at: null });
    expect(judgeVisibility(e, T0).verdict).toBe('unknown_time');
  });
});

describe('时点防火墙 · 日期精度（iFinD 资讯的真实约束）', () => {
  it('前一天发布 → 整日已过去，可见', () => {
    const e = ev({ id: 'd1', precision: 'date', date: '2026-08-02', level: 'B' });
    const j = judgeVisibility(e, T0);
    expect(j.verdict).toBe('visible');
    expect(j.countable).toBe(true);
  });

  it('同一天发布但只有日期 → 分不清盘前盘后，判为 uncertain 且不计权重', () => {
    const e = ev({ id: 'd2', precision: 'date', date: '2026-08-03', level: 'B' });
    const j = judgeVisibility(e, T0);
    expect(j.verdict).toBe('uncertain');
    expect(j.countable).toBe(false);
    expect(j.reason).toContain('盘前还是盘后');
  });

  it('决策时点取到当日收盘之后 → 当日证据转为可见', () => {
    const e = ev({ id: 'd3', precision: 'date', date: '2026-08-03', level: 'B' });
    const cutoff = dayEndMs('2026-08-03');
    expect(judgeVisibility(e, cutoff).verdict).toBe('visible');
  });

  it('后一天发布 → 事后信息', () => {
    const e = ev({ id: 'd4', precision: 'date', date: '2026-08-04', level: 'B' });
    expect(judgeVisibility(e, T0).verdict).toBe('after');
  });
});

describe('时点防火墙 · 无时间信息', () => {
  it('完全没有时间 → unknown_time，不得进入当时视图', () => {
    const e = ev({ id: 'x1', precision: 'none' });
    const j = judgeVisibility(e, T0);
    expect(j.verdict).toBe('unknown_time');
    expect(j.countable).toBe(false);
  });
});

describe('分组与护栏', () => {
  const pool: Evidence[] = [
    ev({ id: 'a-visible', precision: 'ms', at: '2026-08-03 09:40' }),
    ev({ id: 'b-after', precision: 'ms', at: '2026-08-03 14:30' }),
    ev({ id: 'c-same-day-date', precision: 'date', date: '2026-08-03', level: 'B' }),
    ev({ id: 'd-notime', precision: 'none' }),
    ev({ id: 'e-prev-date', precision: 'date', date: '2026-07-31', level: 'B' }),
  ];

  it('四类分组正确，none 类不混入 visible', () => {
    const p = partitionByCutoff(pool, T0);
    expect(p.visible.map((e) => e.id).sort()).toEqual(['a-visible', 'e-prev-date']);
    expect(p.after.map((e) => e.id)).toEqual(['b-after']);
    expect(p.uncertain.map((e) => e.id)).toEqual(['c-same-day-date']);
    expect(p.unknownTime.map((e) => e.id)).toEqual(['d-notime']);
    expect(p.judgements.size).toBe(5);
  });

  it('出口护栏：混入事后信息时抛错，而不是静默渲染', () => {
    const p = partitionByCutoff(pool, T0);
    expect(() => guardNoFutureLeak(p.visible, T0)).not.toThrow();
    expect(() => guardNoFutureLeak([...p.visible, pool[1]], T0)).toThrow(TimeWallViolation);
    try {
      guardNoFutureLeak([pool[1]], T0);
    } catch (err) {
      expect((err as TimeWallViolation).offenders[0].id).toBe('b-after');
      expect((err as TimeWallViolation).offenders[0].verdict).toBe('after');
    }
  });

  it('C 级（用户回忆）即使可见也不计入归因权重', () => {
    const memory = ev({ id: 'mem', precision: 'ms', at: '2026-08-01 20:00', level: 'C' });
    expect(judgeVisibility(memory, T0).verdict).toBe('visible');
    expect(isCountable(memory, T0)).toBe(false);
  });

  it('数据完整度按可见证据中 A 级占比计算', () => {
    const set = [
      ev({ id: 'p1', precision: 'ms', at: '2026-08-01 10:00', level: 'A' }),
      ev({ id: 'p2', precision: 'ms', at: '2026-08-01 10:00', level: 'A' }),
      ev({ id: 'p3', precision: 'date', date: '2026-08-01', level: 'B' }),
      ev({ id: 'p4', precision: 'ms', at: '2026-08-09 10:00', level: 'A' }), // 事后，不计入分母
    ];
    expect(dataCompleteness(set, T0)).toBeCloseTo(2 / 3, 4);
  });
});

describe('回归：真实场景埋点', () => {
  it('「公告在买入后 1 小时发布」不得出现在当时视图', () => {
    const announcement = ev({
      id: 'real-notice-after',
      precision: 'ms',
      at: '2026-08-03 11:23',
      title: '关于签订重大合同的公告',
    });
    const p = partitionByCutoff([announcement], T0);
    expect(p.visible).toHaveLength(0);
    expect(p.after).toHaveLength(1);
    expect(() => guardNoFutureLeak(p.visible, T0)).not.toThrow();
  });

  it('日期精度证据不会因为「属于同一天」而被当成当时可见', () => {
    const sameDayNews = ev({ id: 'same-day', precision: 'date', date: '2026-08-03', level: 'B' });
    const p = partitionByCutoff([sameDayNews], T0);
    expect(p.visible).toHaveLength(0);
    expect(p.uncertain).toHaveLength(1);
  });
});
