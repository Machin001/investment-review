import { NextResponse } from 'next/server';
import { buildPatterns, toSnapshot } from '@/lib/patterns';
import { saveSnapshot, listSnapshots } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshots = await listSnapshots();
  return NextResponse.json({ ok: true, snapshots });
}

/** 保存一次模式快照 —— 由用户主动触发，避免每次渲染都写库 */
export async function POST() {
  try {
    const report = await buildPatterns(true);
    const snap = toSnapshot(report);
    await saveSnapshot(snap);
    return NextResponse.json({ ok: true, snapshot: snap });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
