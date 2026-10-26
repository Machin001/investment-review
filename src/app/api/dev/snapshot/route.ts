import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listPositions, listDecisions } from '@/lib/store';
import { buildReview } from '@/lib/review';
import { buildDecisionCheck } from '@/lib/decision-check';
import { startRecording, dumpRecording, getMode } from '@/lib/providers/kv';

export const dynamic = 'force-dynamic';

/**
 * 录制数据快照（仅本地、仅 DATA_RECORD=1 时可用）
 *
 * 部署环境没有 API Key，靠这份快照让产品展示真实历史数据。
 * 录制覆盖页面上会触发的所有取数组合：每个持仓 × 三个视角 + 每条决策的回检。
 */
export async function POST() {
  if (process.env.DATA_RECORD !== '1') {
    return NextResponse.json(
      { ok: false, error: '未开启录制：请以 DATA_RECORD=1 启动服务' },
      { status: 403 },
    );
  }
  if (getMode() !== 'record') {
    return NextResponse.json({ ok: false, error: `当前数据模式为 ${getMode()}，无法录制` }, { status: 400 });
  }

  const started = Date.now();
  const failures: string[] = [];
  startRecording();

  const positions = await listPositions();
  const viewpoints = ['entry', 'exit', 'today'] as const;

  for (const pos of positions) {
    for (const viewpoint of viewpoints) {
      try {
        await buildReview({ entry: pos.entry, exit: pos.exit, hypothesis: pos.hypothesis, viewpoint });
      } catch (err) {
        failures.push(`复盘 ${pos.entry.name}/${viewpoint}：${(err as Error).message.slice(0, 120)}`);
      }
    }
  }

  for (const d of await listDecisions()) {
    try {
      await buildDecisionCheck(d);
    } catch (err) {
      failures.push(`回检 ${d.name}：${(err as Error).message.slice(0, 120)}`);
    }
  }

  const { count, data } = dumpRecording();

  // 同时写入文件，省去再拷一次
  const out = path.join(process.cwd(), 'src', 'data', 'snapshot', 'providers.json');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(data, null, 1), 'utf8');

  return NextResponse.json({
    ok: true,
    keys: count,
    bytes: JSON.stringify(data).length,
    ms: Date.now() - started,
    failures,
    snapshotPath: out,
  });
}
