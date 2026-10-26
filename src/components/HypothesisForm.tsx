'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Hypothesis } from '@/lib/types';

export default function HypothesisForm({
  tradeId,
  tradeLabel,
  initial,
}: {
  tradeId: string;
  tradeLabel: string;
  initial: Hypothesis | null;
}) {
  const router = useRouter();
  const [claim, setClaim] = useState(initial?.claim ?? '');
  const [trigger, setTrigger] = useState(initial?.trigger ?? '');
  const [falsify, setFalsify] = useState(initial?.falsify ?? '');
  const [counterView, setCounterView] = useState(initial?.counterView ?? '');
  const [horizon, setHorizon] = useState(initial?.horizonTradingDays?.toString() ?? '');
  const [writtenAt, setWrittenAt] = useState(initial?.selfReportedWrittenAt ?? '');
  const [artifact, setArtifact] = useState(Boolean(initial?.artifactDeclared));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError('');
    if (!claim.trim()) return setError('第一题：请用一句话写下你当时的判断');
    if (!falsify.trim()) {
      return setError('第三题必填：没有证伪条件，事后无法判断这笔到底错在哪一步');
    }
    setSaving(true);
    try {
      const res = await fetch('/api/hypothesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId,
          claim,
          trigger,
          falsify,
          counterView,
          horizonTradingDays: horizon ? Number(horizon) : null,
          expectedRangePct: null,
          selfReportedWrittenAt: writtenAt || null,
          artifactDeclared: artifact,
          authoredBy: 'user',
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? '保存失败');
      router.push(`/review/${tradeId}?viewpoint=entry`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const field = 'mt-1.5 w-full rounded-md border border-[#DDE3EA] bg-white px-3 py-2 text-[12.5px] text-ink-900 outline-none focus:border-accent';

  return (
    <div className="mt-6 space-y-5">
      <div>
        <label className="text-[12px] text-ink-900">① 你当时认为会发生什么</label>
        <p className="mt-0.5 text-[11px] text-ink-400">一句话，写成可被检验的判断，不要写“看好”“有空间”</p>
        <input value={claim} onChange={(e) => setClaim(e.target.value)} className={field} placeholder="例：存储涨价周期延续，中报后会有第二波" />
      </div>

      <div>
        <label className="text-[12px] text-ink-900">② 什么信号出现，说明判断正在成立</label>
        <input value={trigger} onChange={(e) => setTrigger(e.target.value)} className={field} placeholder="例：放量站上 380 且板块同步走强" />
      </div>

      <div>
        <label className="text-[12px] text-ink-900">
          ③ 什么情况下你承认自己错了 <span className="text-up">*必填</span>
        </label>
        <p className="mt-0.5 text-[11px] text-ink-400">
          这一题是整个复盘能否成立的前提。写不出可执行的否定条件，就等于没想过会错
        </p>
        <input value={falsify} onChange={(e) => setFalsify(e.target.value)} className={field} placeholder="例：跌破 330，或存储现货报价连续两周回落" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[12px] text-ink-900">④ 预期周期（交易日）</label>
          <input
            value={horizon}
            onChange={(e) => setHorizon(e.target.value.replace(/[^\d]/g, ''))}
            className={field}
            placeholder="例：20"
          />
          <p className="mt-0.5 text-[10.5px] text-ink-400">单位是交易日，对账时会用交易日历，不按自然日算</p>
        </div>
        <div>
          <label className="text-[12px] text-ink-900">⑤ 这条理由你是哪天写的</label>
          <input
            value={writtenAt}
            onChange={(e) => setWrittenAt(e.target.value)}
            className={field}
            placeholder="2026-08-03 10:00"
          />
          <p className="mt-0.5 text-[10.5px] text-ink-400">
            如果晚于决策 24 小时，会标为“事后回忆”，不计入归因权重
          </p>
        </div>
      </div>

      <div className="rounded-md border border-[#E3E8EE] bg-[#FAFBFC] px-3 py-2.5">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={artifact}
            onChange={(e) => setArtifact(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[#1F45AC]"
          />
          <span className="text-[11.5px] leading-relaxed text-ink-600">
            我保留了当时的依据（截图 / 笔记 / 聊天记录）
            <span className="mt-0.5 block text-[10.5px] text-ink-400">
              勾选后，这条事后补写的台账会记为「有依据的回忆」而不是纯回忆。
              注意：这是你的自述，产品无法验证。
            </span>
          </span>
        </label>
      </div>

      <div>
        <label className="text-[12px] text-ink-900">⑥ 你认为最有道理的反驳是什么</label>
        <textarea
          value={counterView}
          onChange={(e) => setCounterView(e.target.value)}
          rows={2}
          className={field}
          placeholder="例：涨幅已经很大，机构可能借中报兑现出货"
        />
      </div>

      {error && <div className="rounded-md border border-up/30 bg-up/5 px-3 py-2 text-[12px] text-up">{error}</div>}

      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-md bg-ink-900 px-4 py-2 text-[12px] text-white hover:bg-ink-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : `保存台账并复盘 ${tradeLabel}`}
        </button>
        <span className="text-[11px] text-ink-400">保存后进入时间线，你能看到「当时的我」到底知道什么</span>
      </div>
    </div>
  );
}
