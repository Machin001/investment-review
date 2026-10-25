import { NextResponse } from 'next/server';
import { listDecisions, saveDecisionCheck, getDecision } from '@/lib/store';
import { buildDecisionChecks, buildDecisionCheck, executionStats } from '@/lib/decision-check';
import type { DecisionCheck } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** GET /api/decisions → 决策列表 + 自动回检事实 */
export async function GET() {
  try {
    const decisions = await listDecisions();
    const views = await buildDecisionChecks(decisions);
    return NextResponse.json({ ok: true, views, stats: executionStats(views) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}

/**
 * POST /api/decisions → 写入回检结果
 * body: { decisionId, verdict, note }
 * 自动事实由服务端重新计算，**不接受客户端传上来的数字**，避免被篡改或与计算口径不一致
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      decisionId?: string;
      verdict?: 'followed' | 'partial' | 'ignored';
      note?: string;
    };

    if (!body.decisionId) {
      return NextResponse.json({ ok: false, error: '缺少 decisionId' }, { status: 400 });
    }
    if (!body.verdict || !['followed', 'partial', 'ignored'].includes(body.verdict)) {
      return NextResponse.json(
        { ok: false, error: '请选择当时的清单执行情况（完全执行 / 部分执行 / 没有执行）' },
        { status: 400 },
      );
    }

    const decision = await getDecision(body.decisionId);
    if (!decision) {
      return NextResponse.json({ ok: false, error: `未找到决策 ${body.decisionId}` }, { status: 404 });
    }

    const { facts } = await buildDecisionCheck(decision);
    const check: DecisionCheck = {
      checkedAtMs: Date.now(),
      verdict: body.verdict,
      note: (body.note ?? '').trim(),
      auto: facts,
    };

    await saveDecisionCheck(body.decisionId, check);
    return NextResponse.json({ ok: true, check });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
