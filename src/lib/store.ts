/**
 * 本地持久化
 *
 * 数据量很小（几十笔交易 + 若干复盘会话），用 JSON 文件足够，
 * 且能完整保留原始录入内容便于对账。换成 SQLite 只需替换这一层。
 *
 * 并发模型（重要）：
 *   1. 单飞初始化 —— 冷启动时多个请求同时到达，只有一个真正读盘/写种子；
 *   2. 写操作串行 —— 所有写都走同一条 Promise 队列，避免读-改-写互相覆盖；
 *   3. 原子落盘 —— 先写 .tmp 再 rename，进程中断不会留下半个 JSON；
 *   4. 落盘失败不抛 —— 内存状态仍然一致，页面照常渲染（失败原因可用 getStoreHealth 查）。
 *
 * 这几条来自一次真实事故：首页 Promise.all 并发读 store 时，
 * 旧实现会各自写种子并互相覆盖，Windows 上直接 EPERM 500，并发写入还会丢数据。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DecisionCheck, DecisionRecord, Hypothesis, LearningAsset, PatternSnapshot, Trade } from './types';
import { SEED_DECISIONS, SEED_HYPOTHESES, SEED_SNAPSHOTS, SEED_TRADES } from '@/data/seed';

const DATA_DIR = path.join(process.cwd(), 'data', 'runtime');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const TMP_FILE = `${STORE_FILE}.tmp`;

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

function seedStore(): StoreShape {
  return {
    version: 1,
    trades: [...SEED_TRADES],
    hypotheses: { ...SEED_HYPOTHESES },
    assets: [],
    decisions: [...SEED_DECISIONS],
    snapshots: [...SEED_SNAPSHOTS],
  };
}

let state: StoreShape | null = null;
let initPromise: Promise<StoreShape> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
let lastPersistError: string | null = null;

/** 原子写：先落临时文件，再改名覆盖 */
async function atomicWrite(s: StoreShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TMP_FILE, JSON.stringify(s, null, 2), 'utf8');
  // Windows 上 rename 偶尔被句柄占用（杀毒/索引器），做有限重试
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fs.rename(TMP_FILE, STORE_FILE);
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
    }
  }
}

async function persist(s: StoreShape): Promise<void> {
  try {
    await atomicWrite(s);
    lastPersistError = null;
  } catch (err) {
    // 不抛：内存状态仍一致，页面不该因为磁盘问题 500
    lastPersistError = (err as Error).message;
  }
}

async function ensureLoaded(): Promise<StoreShape> {
  if (state) return state;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const raw = await fs.readFile(STORE_FILE, 'utf8');
        state = { ...EMPTY, ...(JSON.parse(raw) as StoreShape) };
      } catch {
        // 文件不存在或损坏：用种子，并尽力落盘（失败不影响本次会话）
        state = seedStore();
        await persist(state);
      }
      return state;
    })();
  }
  return initPromise;
}

/** 写操作统一入队，串行执行 */
function enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readState(): Promise<StoreShape> {
  return structuredClone(await ensureLoaded());
}

async function mutate<T>(fn: (s: StoreShape) => T): Promise<T> {
  return enqueue(async () => {
    const s = await ensureLoaded();
    const result = fn(s);
    await persist(s);
    return result;
  });
}

/** 存储健康状态，供诊断用（落盘失败时界面可提示，但不阻断） */
export function getStoreHealth(): { persisted: boolean; error: string | null } {
  return { persisted: lastPersistError === null, error: lastPersistError };
}

// ---------------------------------------------------------------- 读取

export async function listTrades(): Promise<Trade[]> {
  return (await readState()).trades;
}

/** 建仓记录（side=buy）才是复盘的入口，卖出记录作为配对 */
export async function listPositions(): Promise<
  { entry: Trade; exit: Trade | null; hypothesis: Hypothesis | null }[]
> {
  const s = await readState();
  return s.trades
    .filter((t) => t.side === 'buy')
    .map((entry) => ({
      entry,
      exit: s.trades.find((t) => t.positionId === entry.positionId && t.side === 'sell') ?? null,
      hypothesis: s.hypotheses[entry.id] ?? null,
    }));
}

export async function getTrade(id: string): Promise<Trade | null> {
  return (await readState()).trades.find((t) => t.id === id) ?? null;
}

export async function getPosition(positionIdOrEntryId: string): Promise<{
  entry: Trade;
  exit: Trade | null;
  hypothesis: Hypothesis | null;
} | null> {
  const s = await readState();
  const entry =
    s.trades.find((t) => t.id === positionIdOrEntryId && t.side === 'buy') ??
    s.trades.find((t) => t.positionId === positionIdOrEntryId && t.side === 'buy');
  if (!entry) return null;
  const exit = s.trades.find((t) => t.positionId === entry.positionId && t.side === 'sell') ?? null;
  return { entry, exit, hypothesis: s.hypotheses[entry.id] ?? null };
}

export async function listAssets(): Promise<LearningAsset[]> {
  return (await readState()).assets;
}

export async function listDecisions(): Promise<DecisionRecord[]> {
  return (await readState()).decisions;
}

export async function getDecision(id: string): Promise<DecisionRecord | null> {
  return (await readState()).decisions.find((d) => d.id === id) ?? null;
}

export async function listSnapshots(): Promise<PatternSnapshot[]> {
  return (await readState()).snapshots;
}

// ---------------------------------------------------------------- 写入

export async function saveHypothesis(tradeId: string, h: Hypothesis): Promise<void> {
  await mutate((s) => {
    s.hypotheses[tradeId] = h;
  });
}

export async function addTrades(trades: Trade[]): Promise<{ added: number; total: number }> {
  return mutate((s) => {
    const byId = new Map(s.trades.map((t) => [t.id, t]));
    let added = 0;
    for (const t of trades) {
      if (!byId.has(t.id)) added += 1;
      byId.set(t.id, t);
    }
    s.trades = [...byId.values()];
    return { added, total: s.trades.length };
  });
}

export async function saveAssets(assets: LearningAsset[]): Promise<void> {
  await mutate((s) => {
    const byId = new Map(s.assets.map((a) => [a.id, a]));
    for (const a of assets) byId.set(a.id, a);
    s.assets = [...byId.values()];
  });
}

export async function recordDecision(d: DecisionRecord): Promise<void> {
  await mutate((s) => {
    s.decisions = [...s.decisions.filter((x) => x.id !== d.id), d];
  });
}

/** 写入回检结果 */
export async function saveDecisionCheck(id: string, check: DecisionCheck): Promise<void> {
  await mutate((s) => {
    const target = s.decisions.find((d) => d.id === id);
    if (!target) throw new Error(`未找到决策 ${id}`);
    target.check = check;
  });
}

/** 追加一条快照；同一天只保留最新一条 */
export async function saveSnapshot(snap: PatternSnapshot): Promise<void> {
  await mutate((s) => {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const sameDay = s.snapshots.filter((x) => day(x.atMs) === day(snap.atMs));
    s.snapshots = [...s.snapshots.filter((x) => !sameDay.some((d) => d.id === x.id)), snap].sort(
      (a, b) => a.atMs - b.atMs,
    );
  });
}
