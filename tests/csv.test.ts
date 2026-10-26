import { describe, it, expect } from 'vitest';
import { parseTradeCsv } from '@/lib/csv';

const HEADER = '成交日期,证券代码,证券名称,买卖标志,成交价格,成交数量,成交金额,手续费';
const ROW1 = '2026-08-03,603986,兆易创新,证券买入,340.74,200,68148.00,20.44';
const ROW2 = '2026-08-05,603986,兆易创新,证券卖出,385.44,200,77088.00,23.13';

describe('交割单解析', () => {
  it('识别列名并解析出交易', () => {
    const r = parseTradeCsv(`${HEADER}\n${ROW1}`);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].thscode).toBe('603986.SH');
    expect(r.trades[0].side).toBe('buy');
    expect(r.trades[0].price).toBe(340.74);
    expect(r.errors).toHaveLength(0);
    expect(r.mapping.price).toBe('成交价格');
  });

  it('交易 id 内容寻址：两次解析同一行，id 完全一致', () => {
    const a = parseTradeCsv(`${HEADER}\n${ROW1}`).trades[0].id;
    const b = parseTradeCsv(`${HEADER}\n${ROW1}`).trades[0].id;
    expect(a).toBe(b);
  });

  it('行顺序变化不改变 id（重导不会产生重复记录）', () => {
    const first = parseTradeCsv(`${HEADER}\n${ROW1}\n${ROW2}`).trades;
    const second = parseTradeCsv(`${HEADER}\n${ROW2}\n${ROW1}`).trades;
    const key = (t: { id: string }) => t.id;
    expect(first.map(key).sort()).toEqual(second.map(key).sort());
  });

  it('内容不同则 id 不同', () => {
    const a = parseTradeCsv(`${HEADER}\n${ROW1}`).trades[0].id;
    const c = parseTradeCsv(`${HEADER}\n${ROW1.replace('340.74', '341.74')}`).trades[0].id;
    expect(a).not.toBe(c);
  });

  it('方向无法识别的行进 errors，不静默丢弃', () => {
    const r = parseTradeCsv(`${HEADER}\n2026-08-03,603986,兆易创新,未知操作,340.74,200,68148,20`);
    expect(r.trades).toHaveLength(0);
    expect(r.errors[0]).toContain('买卖方向');
  });

  it('缺必需列时直接报错并回显表头', () => {
    const r = parseTradeCsv('日期,代码\n2026-08-03,603986');
    expect(r.trades).toHaveLength(0);
    expect(r.errors[0]).toContain('未识别到必需列');
  });
});
