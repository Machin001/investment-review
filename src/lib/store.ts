/**
 * 本地持久化
 *
 * 数据量很小（几十笔交易 + 若干复盘会话），用 JSON 文件足够，
 * 且能完整保留原始录入内容便于对账。换成 SQLite 只需替换这一层。
 *
 * 运行时数据写在 data/runtime/（已 join .gitignore），种子用 src/data/seed.ts。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DecisionCheck, DecisionRecord, Hypothesis, LearningAsset, PatternSnapshot, Trade } from './types';
import { SEED_DECISIONS, SEED_HYPOTHESES, SEED_SNAPSHOTS, SEED_TRADES } from '@/data/seed';

const DATA_DIR = path.join(process.cwd(), 'data', 'runtime');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

interface StoreShape {
  version: number;
  trades: Trade[];
  hypotheses: Record<string, Hypothesis>;
  assets: LearningAsset[];
  /** 用户新建的决策（提醒卡回灌 + 事后回检） */
  decisions: DecisionRecord[];
  /** 模式面板历史快照 */
  snapshots: PatternSnapshot[];
}

const EMPTY: StoreShape = { version: 1, trades: [], hypotheses: {}, assets: [], decisions: [], snapshots: [] };

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as StoreShape;
    return { ...EMPTY, ...parsed };
  } catch {
    const seeded: StoreShape = {
      version: 1,
      trades: [...SEED_TRADES],
      hypotheses: { ...SEED_HYPOTHESES },
      assets: [],
      decisions: [...SEED_DECISIONS],
      snapshots: [...SEED_SNAPSHOTS],
    };
    await writeStore(seeded);
    return seeded;
  }
}

async function writeStore(data: StoreShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export async function listTrades(): Promise<Trade[]> {
  const s = await readStore();
  return s.trades;
}

/** 建仓记录（side=buy）才是复盘的入口，卖出记录作为配对 */
export async function listPositions(): Promise<
  { entry: Trade; exit: Trade | null; hypothesis: Hypothesis | null }[]
> {
  const s = await readStore();
  const buys = s.trades.filter((t) => t.side === 'buy');
  return buys.map((entry) => {
    const exit = s.trades.find((t) => t.positionId === entry.positionId && t.side === 'sell') ?? null;
    return { entry, exit, hypothesis: s.hypotheses[entry.id] ?? null };
  });
}

export async function getTrade(id: string): Promise<Trade | null> {
  const s = await readStore();
  return s.trades.find((t) => t.id === id) ?? null;
}

export async function getPosition(positionIdOrEntryId: string): Promise<{
  entry: Trade;
  exit: Trade | null;
  hypothesis: Hypothesis | null;
} | null> {
  const s = await readStore();
  const entry =
    s.trades.find((t) => t.id === positionIdOrEntryId && t.side === 'buy') ??
    s.trades.find((t) => t.positionId === positionIdOrEntryId && t.side === 'buy');
  if (!entry) return null;
  const exit = s.trades.find((t) => t.positionId === entry.positionId && t.side === 'sell') ?? null;
  return { entry, exit, hypothesis: s.hypotheses[entry.id] ?? null };
}

export async function saveHypothesis(tradeId: string, h: Hypothesis): Promise<void> {
  const s = await readStore();
  s.hypotheses[tradeId] = h;
  await writeStore(s);
}

export async function addTrades(trades: Trade[]): Promise<{ added: number; total: number }> {
  const s = await readStore();
  const byId = new Map(s.trades.map((t) => [t.id, t]));
  let added = 0;
  for (const t of trades) {
    if (!byId.has(t.id)) added += 1;
    byId.set(t.id, t);
  }
  s.trades = [...byId.values()];
  await writeStore(s);
  return { added, total: s.trades.length };
}

export async function listAssets(): Promise<LearningAsset[]> {
  return (await readStore()).assets;
}

export async function saveAssets(assets: LearningAsset[]): Promise<void> {
  const s = await readStore();
  const byId = new Map(s.assets.map((a) => [a.id, a]));
  for (const a of assets) byId.set(a.id, a);
  s.assets = [...byId.values()];
  await writeStore(s);
}

export async function recordDecision(d: DecisionRecord): Promise<void> {
  const s = await readStore();
  s.decisions = [...s.decisions.filter((x) => x.id !== d.id), d];
  await writeStore(s);
}

export async function listDecisions(): Promise<DecisionRecord[]> {
  return (await readStore()).decisions;
}

export async function getDecision(id: string): Promise<DecisionRecord | null> {
  return (await listDecisions()).find((d) => d.id === id) ?? null;
}

/** 写入回检结果 */
export async function saveDecisionCheck(id: string, check: DecisionCheck): Promise<void> {
  const s = await readStore();
  const target = s.decisions.find((d) => d.id === id);
  if (!target) throw new Error(`未找到决策 ${id}`);
  target.check = check;
  await writeStore(s);
}

export async function listSnapshots(): Promise<PatternSnapshot[]> {
  return (await readStore()).snapshots;
}

/** 追加一条快照；同一天只保留最新一条 */
export async function saveSnapshot(snap: PatternSnapshot): Promise<void> {
  const s = await readStore();
  const sameDay = s.snapshots.filter(
    (x) => new Date(x.atMs).toISOString().slice(0, 10) === new Date(snap.atMs).toISOString().slice(0, 10),
  );
  s.snapshots = [...s.snapshots.filter((x) => !sameDay.some((d) => d.id === x.id)), snap].sort(
    (a, b) => a.atMs - b.atMs,
  );
  await writeStore(s);
}
