import { describe, it, expect } from 'vitest';
import { parseFalsifyThreshold } from '@/lib/decision-check';

describe('证伪条件的价格阈值解析', () => {
  it('跌破 330 → 下行阈值 330', () => {
    expect(parseFalsifyThreshold('跌破 330，或存储现货报价连续两周回落')).toEqual({ value: 330, direction: 'down' });
  });

  it('站上 1400 并放量 → 上行阈值 1400', () => {
    expect(parseFalsifyThreshold('站上 1400 并放量')).toEqual({ value: 1400, direction: 'up' });
  });

  it('带小数的价格可以解析', () => {
    expect(parseFalsifyThreshold('跌穿 39.70 就认错')).toEqual({ value: 39.7, direction: 'down' });
  });

  it('均线周期不是价格阈值 —— 不能把 20 日当成 20 块', () => {
    expect(parseFalsifyThreshold('收盘低于 20 日均线就减仓')).toBeNull();
  });

  it('百分比阈值不解析为价格', () => {
    expect(parseFalsifyThreshold('亏 8% 就卖')).toBeNull();
  });

  it('纯文字没有阈值 → null，不猜', () => {
    expect(parseFalsifyThreshold('如果逻辑被证伪就走')).toBeNull();
    expect(parseFalsifyThreshold('没有专门想过')).toBeNull();
  });

  it('空值 → null', () => {
    expect(parseFalsifyThreshold(null)).toBeNull();
    expect(parseFalsifyThreshold('')).toBeNull();
  });
});
