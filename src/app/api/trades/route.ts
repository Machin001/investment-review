import { NextResponse } from 'next/server';
import { listPositions, addTrades } from '@/lib/store';
import { parseTradeCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';

/** 列出所有持仓（建仓记录 + 配对卖出 + 假设台账） */
export async function GET() {
  try {
    const positions = await listPositions();
    return NextResponse.json({ ok: true, positions });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

/**
 * 导入交易记录
 * body: { csv?: string, trades?: Trade[], mode: 'preview' | 'commit' }
 * preview 只解析不落库，让用户先核对字段映射与逐行错误
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { csv?: string; mode?: 'preview' | 'commit' };

    if (!body.csv || !body.csv.trim()) {
      return NextResponse.json({ ok: false, error: 'csv 内容为空' }, { status: 400 });
    }

    const parsed = parseTradeCsv(body.csv);

    if (body.mode === 'preview') {
      return NextResponse.json({
        ok: true,
        mapping: parsed.mapping,
        parsedCount: parsed.trades.length,
        errors: parsed.errors,
        preview: parsed.trades.slice(0, 8),
      });
    }

    if (parsed.trades.length === 0) {
      return NextResponse.json(
        { ok: false, error: '没有解析出任何有效交易，请检查表头与内容', errors: parsed.errors },
        { status: 400 },
      );
    }

    const result = await addTrades(parsed.trades);
    return NextResponse.json({ ok: true, ...result, errors: parsed.errors });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
