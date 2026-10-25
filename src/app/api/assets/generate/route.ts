import { NextResponse } from 'next/server';
import { listPositions, saveAssets } from '@/lib/store';
import { buildReview } from '@/lib/review';

export const dynamic = 'force-dynamic';

/**
 * 从已有的复盘结果批量生成学习资产
 *
 * 用的就是复盘页那套逻辑（真实偏差命中 → 资产生成），不是伪造清单。
 * 缺少凭证或取数失败时明确报错，不返回「成功 0 条」蒙混。
 */
export async function POST() {
  try {
    const positions = await listPositions();
    const all: Awaited<ReturnType<typeof buildReview>>['assets'] = [];
    const failed: string[] = [];

    for (const pos of positions) {
      try {
        const payload = await buildReview({
          entry: pos.entry,
          exit: pos.exit,
          hypothesis: pos.hypothesis,
          viewpoint: 'today',
        });
        all.push(...payload.assets);
      } catch (err) {
        failed.push(`${pos.entry.name}：${(err as Error).message.slice(0, 80)}`);
      }
    }

    if (all.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: '没有生成任何清单条目（可能所有交易都未命中偏差规则，或取数失败）',
          failed,
        },
        { status: 422 },
      );
    }

    await saveAssets(all);
    return NextResponse.json({ ok: true, added: all.length, failed });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
