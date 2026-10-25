'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const OPTIONS: { key: 'followed' | 'partial' | 'ignored'; label: string; hint: string }[] = [
  { key: 'followed', label: '完全执行', hint: '当时确认的清单条目都照做了' },
  { key: 'partial', label: '部分执行', hint: '做了几条，但有关键的没做' },
  { key: 'ignored', label: '没有执行', hint: '当时确认了，实际没照做' },
];

export default function DecisionCheckForm({ decisionId }: { decisionId: string }) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<'followed' | 'partial' | 'ignored' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!verdict) {
      setError('请选择当时的清单执行情况');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionId, verdict, note }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? '保存失败');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-[#E3E8EE] bg-[#FAFBFC] p-3">
      <div className="text-[11.5px] text-ink-700">回检：当时确认的清单，你实际执行了没有？</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setVerdict(o.key)}
            title={o.hint}
            className={`rounded border px-2.5 py-1 text-[11.5px] ${
              verdict === o.key
                ? 'border-ink-900 bg-ink-900 text-white'
                : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="补一句：为什么没执行 / 哪条起了作用（可留空）"
        className="mt-2 w-full rounded border border-[#DDE3EA] bg-white px-2.5 py-1.5 text-[11.5px] outline-none focus:border-accent"
      />
      {error && <div className="mt-1.5 text-[11px] text-up">{error}</div>}
      <button
        onClick={submit}
        disabled={saving || !verdict}
        className={`mt-2 rounded px-3 py-1.5 text-[11.5px] ${
          verdict ? 'bg-ink-900 text-white hover:bg-ink-700' : 'cursor-not-allowed bg-ink-200 text-ink-400'
        }`}
      >
        {saving ? '保存中…' : '提交回检'}
      </button>
    </div>
  );
}
