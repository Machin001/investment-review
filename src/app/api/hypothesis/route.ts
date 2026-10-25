import { NextResponse } from 'next/server';
import { getTrade, saveHypothesis, getPosition } from '@/lib/store';
import { classifyHypothesisAnchor } from '@/lib/evidence';
import type { Hypothesis, HypothesisAnchor } from '@/lib/types';
import { parseDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** 保存假设台账 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      tradeId: string;
      claim: string;
      trigger: string;
      falsify: string;
      horizonTradingDays: number | null;
      expectedRangePct: [number, number] | null;
      counterView: string;
      selfReportedWrittenAt: string | null;
      authoredBy?: 'user' | 'ai_assisted' | 'ai_generated';
    };

    // 证伪条件是复盘能否成立的前提，为空直接拒绝
    if (!body.falsify || !body.falsify.trim()) {
      return NextResponse.json(
        { ok: false, error: '证伪条件不能为空：没有它，这笔交易事后无法判断到底错在哪一步' },
        { status: 400 },
      );
    }
    if (!body.claim || !body.claim.trim()) {
      return NextResponse.json({ ok: false, error: '请用一句话写下你当时的判断' }, { status: 400 });
    }

    const trade = await getTrade(body.tradeId);
    if (!trade) {
      return NextResponse.json({ ok: false, error: `未找到交易 ${body.tradeId}` }, { status: 404 });
    }

    // 锚定可信度：录入时间早于决策 + 24h 才算 contemporaneous
    const predeclared = body.selfReportedWrittenAt ? parseDateTime(body.selfReportedWrittenAt) : null;
    const createdAtMs = predeclared ?? Date.now();
    const anchor: HypothesisAnchor = classifyHypothesisAnchor({
      createdAtMs,
      decisionAtMs: trade.tradedAtMs,
      crossChecked: false,
    });

    const hypothesis: Hypothesis = {
      claim: body.claim.trim(),
      trigger: body.trigger.trim(),
      falsify: body.falsify.trim(),
      horizonTradingDays: body.horizonTradingDays,
      expectedRangePct: body.expectedRangePct,
      counterView: body.counterView?.trim() ?? '',
      authoredBy: body.authoredBy ?? 'user',
      createdAtMs,
      selfReportedWrittenAt: body.selfReportedWrittenAt,
      anchor,
      isBackfilled: anchor === 'recall_only',
    };

    await saveHypothesis(body.tradeId, hypothesis);
    return NextResponse.json({ ok: true, hypothesis, position: await getPosition(body.tradeId) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
