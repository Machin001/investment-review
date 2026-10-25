/**
 * 学习资产回灌
 *
 * 「可复用的学习」如果只停留在复盘页底部，用户看完就忘。
 * 这里把资产在下一次建仓前调出来，并说清「为什么调出这一条」——
 * 匹配规则是确定的字符串规则，不是模型猜的。
 */

import type { LearningAsset } from './types';
import { listAssets } from './store';

export type MatchKind = 'same_symbol' | 'same_sector' | 'generic';

export interface AssetMatch {
  asset: LearningAsset;
  kind: MatchKind;
  /** 为什么调出这条，直接展示给用户 */
  reason: string;
}

const GENERIC_TRIGGER = /任何|新建仓|买入前|建仓|下单|卖出/;

export async function loadAssetMatches(ctx: {
  name?: string;
  thscode?: string;
  sectorKeyword?: string;
}): Promise<AssetMatch[]> {
  const assets = await listAssets();
  const name = ctx.name?.trim();
  const code = ctx.thscode?.trim();
  const sector = ctx.sectorKeyword?.trim();
  const out = new Map<string, AssetMatch>();

  for (const a of assets) {
    const haystack = `${a.trigger} ${a.content}`;
    if (name && haystack.includes(name)) {
      out.set(a.id, { asset: a, kind: 'same_symbol', reason: `同一标的（${name}）的复盘结论` });
      continue;
    }
    if (code && haystack.includes(code)) {
      out.set(a.id, { asset: a, kind: 'same_symbol', reason: `同一标的（${code}）的复盘结论` });
      continue;
    }
    if (sector && haystack.includes(sector)) {
      out.set(a.id, { asset: a, kind: 'same_sector', reason: `同一板块（${sector}）出现过的情况` });
      continue;
    }
    if (GENERIC_TRIGGER.test(a.trigger)) {
      out.set(a.id, { asset: a, kind: 'generic', reason: `通用检查项：${a.trigger}` });
    }
  }

  const order: MatchKind[] = ['same_symbol', 'same_sector', 'generic'];
  return [...out.values()].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind));
}
