import { NextResponse } from 'next/server';
import { listAssets, saveAssets, recordDecision, listDecisions } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [assets, decisions] = await Promise.all([listAssets(), listDecisions()]);
  return NextResponse.json({ ok: true, assets, decisions });
}

/** 把某次复盘产出的学习资产落库 */
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
