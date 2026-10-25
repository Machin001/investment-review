import { NextResponse } from 'next/server';
import { getPosition } from '@/lib/store';
import { buildReview } from '@/lib/review';
import type { Viewpoint } from '@/lib/review';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const url = new URL(req.url);
  const vp = (url.searchParams.get('viewpoint') ?? 'today') as Viewpoint;
  const viewpoint: Viewpoint = ['entry', 'exit', 'today'].includes(vp) ? vp : 'today';

  try {
    const pos = await getPosition(ctx.params.id);
    if (!pos) {
      return NextResponse.json({ ok: false, error: `未找到持仓 ${ctx.params.id}` }, { status: 404 });
    }

    const payload = await buildReview({
      entry: pos.entry,
      exit: pos.exit,
      hypothesis: pos.hypothesis,
      viewpoint,
    });

    return NextResponse.json({ ok: true, payload });
  } catch (err) {
    // 取数失败不伪造结论：明确返回错误，由界面显示「本次复盘未能生成」并给出原因
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
