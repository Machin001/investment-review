'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Match {
  asset: { id: string; kind: string; content: string; trigger: string; fromSessionId: string };
  kind: 'same_symbol' | 'same_sector' | 'generic';
  reason: string;
}

const KIND_LABEL: Record<string, string> = {
  same_symbol: '同标的',
  same_sector: '同板块',
  generic: '通用项',
};

const KIND_STYLE: Record<string, string> = {
  same_symbol: 'border-up/40 bg-up/5 text-up',
  same_sector: 'border-warnLine/40 bg-warnSoft text-warnLine',
  generic: 'border-ink-300 bg-ink-100 text-ink-500',
};

export default function PlanChecklist() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sector, setSector] = useState('');
  const [plannedPrice, setPlannedPrice] = useState('');
  const [falsify, setFalsify] = useState('');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    setSaved(false);
    try {
      const qs = new URLSearchParams({ match: '1' });
      if (name.trim()) qs.set('name', name.trim());
      if (code.trim()) qs.set('code', code.trim());
      if (sector.trim()) qs.set('sector', sector.trim());
      const res = await fetch(`/api/assets?${qs.toString()}`);
      const json = (await res.json()) as { ok: boolean; matches?: Match[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? '调取失败');
      setMatches(json.matches ?? []);
      setChecked({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!matches) return;
    const missing = matches.filter((m) => !checked[m.asset.id]);
    if (missing.length > 0) {
      setError(`还有 ${missing.length} 条没有确认，不能记录建仓`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: {
            id: `D-${Date.now()}`,
            thscode: code.trim() || name.trim(),
            name: name.trim() || code.trim(),
            createdAtMs: Date.now(),
            plannedPrice: plannedPrice ? Number(plannedPrice) : null,
            falsify: falsify.trim() || null,
            sectorQuery: sector.trim() || undefined,
            checkedAssetIds: matches.map((m) => m.asset.id),
            check: null,
          },
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? '记录失败');
      setSaved(true);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const allChecked = matches !== null && matches.length > 0 && matches.every((m) => checked[m.asset.id]);
  const field =
    'w-full rounded-md border border-[#DDE3EA] bg-white px-3 py-2 text-[12.5px] text-ink-900 outline-none focus:border-accent';

  return (
    <div>
      <div className="mt-6 grid grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="text-[12px] text-ink-900">标的名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="例：兆易创新" />
        </div>
        <div>
          <label className="text-[12px] text-ink-900">代码（可选）</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={field} placeholder="603986.SH" />
        </div>
        <div>
          <label className="text-[12px] text-ink-900">板块（可选）</label>
          <input value={sector} onChange={(e) => setSector(e.target.value)} className={field} placeholder="半导体" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="text-[12px] text-ink-900">计划买入价（可选）</label>
          <input
            value={plannedPrice}
            onChange={(e) => setPlannedPrice(e.target.value.replace(/[^\d.]/g, ''))}
            className={field}
            placeholder="回检时用它当基准，不填则用决策日收盘价"
          />
        </div>
        <div>
          <label className="text-[12px] text-ink-900">这次的证伪条件（可选，但强烈建议）</label>
          <input
            value={falsify}
            onChange={(e) => setFalsify(e.target.value)}
            className={field}
            placeholder="例：跌破 330 就承认判断错了"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={load}
          disabled={loading || (!name.trim() && !code.trim())}
          className="rounded-md border border-ink-200 px-3.5 py-2 text-[12px] text-ink-700 hover:border-ink-400 disabled:opacity-40"
        >
          {loading ? '调取中…' : '调出我的历史清单'}
        </button>
        <span className="text-[11px] text-ink-400">
          按标的 / 板块 / 通用情境匹配，匹配规则是字符串规则，不是模型猜的
        </span>
      </div>

      {error && <div className="mt-4 rounded-md border border-up/30 bg-up/5 px-3 py-2 text-[12px] text-up">{error}</div>}

      {saved && (
        <div className="mt-4 rounded-card border border-down/30 bg-down/5 px-4 py-3 text-[12px] text-down">
          已记录这次建仓决策，勾选的 {matches?.length ?? 0} 条清单已存档。
          <Link href="/" className="ml-2 underline">
            回到工作台
          </Link>
        </div>
      )}

      {matches !== null && !saved && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-medium text-ink-900">
              建仓前检查清单
              <span className="ml-2 text-[11px] font-normal text-ink-400">
                {matches.length} 条，全部确认后才能记录
              </span>
            </h2>
            {matches.length > 0 && (
              <button
                onClick={() => setChecked(Object.fromEntries(matches.map((m) => [m.asset.id, true])))}
                className="text-[11px] text-accent hover:underline"
              >
                全部确认
              </button>
            )}
          </div>

          {matches.length === 0 ? (
            <p className="mt-3 rounded-card border border-[#E3E8EE] bg-white p-4 text-[11.5px] text-ink-400">
              没有匹配到历史结论。这可能是好事，也可能说明你还没沉淀过同类经验 ——
              先去做一次同类复盘，清单才会有内容。
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {matches.map((m) => (
                <li
                  key={m.asset.id}
                  className={`rounded-card border bg-white px-4 py-3 ${
                    checked[m.asset.id] ? 'border-down/40' : 'border-[#E3E8EE]'
                  }`}
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={Boolean(checked[m.asset.id])}
                      onChange={(e) => setChecked((s) => ({ ...s, [m.asset.id]: e.target.checked }))}
                      className="mt-1 h-3.5 w-3.5 accent-[#1E9E62]"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`rounded border px-1 text-[10px] leading-[16px] ${KIND_STYLE[m.kind]}`}>
                          {KIND_LABEL[m.kind]}
                        </span>
                        <span className="text-[11px] text-ink-400">{m.reason}</span>
                      </div>
                      <div className="mt-1 text-[12.5px] leading-relaxed text-ink-900">{m.asset.content}</div>
                      <div className="mt-0.5 text-[10.5px] text-ink-400">
                        触发条件：{m.asset.trigger} · 来自复盘 {m.asset.fromSessionId}
                      </div>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {matches.length > 0 && (
            <button
              onClick={commit}
              disabled={!allChecked || loading}
              className={`mt-4 rounded-md px-4 py-2 text-[12px] ${
                allChecked
                  ? 'bg-ink-900 text-white hover:bg-ink-700'
                  : 'cursor-not-allowed bg-ink-200 text-ink-400'
              }`}
            >
              {allChecked ? '确认建仓，记录决策' : `还有 ${matches.filter((m) => !checked[m.asset.id]).length} 条未确认`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
