import { NextResponse } from 'next/server';
import { listAssets, saveAssets, recordDecision, listDecisions } from '@/lib/store';
import { loadAssetMatches } from '@/lib/learning';

export const dynamic = 'force-dynamic';

/**
 * GET /api/assets
 *   ?match=1&name=贵州茅台&code=600519.SH&sector=白酒 → 按情境匹配到的历史学习资产
 *   无参数 → 全部资产与决策记录
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('match') === '1') {
    const matches = await loadAssetMatches({
      name: url.searchParams.get('name') ?? undefined,
      thscode: url.searchParams.get('code') ?? undefined,
      sectorKeyword: url.searchParams.get('sector') ?? undefined,
    });
    return NextResponse.json({ ok: true, matches });
  }

  const [assets, decisions] = await Promise.all([listAssets(), listDecisions()]);
  return NextResponse.json({ ok: true, assets, decisions });
}

/** 把某次复盘产出的学习资产落库；或记录一次建仓前决策 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      assets?: Parameters<typeof saveAssets>[0];
      decision?: Parameters<typeof recordDecision>[0];
    };
    if (body.assets?.length) await saveAssets(body.assets);
    if (body.decision) await recordDecision(body.decision);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
