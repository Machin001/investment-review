'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SaveSnapshotButton() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function save() {
    setState('saving');
    try {
      const res = await fetch('/api/patterns', { method: 'POST' });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? '保存失败');
      setState('done');
      setMsg('已记录本次快照');
      router.refresh();
    } catch (err) {
      setState('error');
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className={`text-[11px] ${state === 'error' ? 'text-up' : 'text-down'}`}>{msg}</span>}
      <button
        onClick={save}
        disabled={state === 'saving' || state === 'done'}
        className={`rounded-md px-3 py-1.5 text-[11.5px] ${
          state === 'done'
            ? 'border border-down/30 bg-down/5 text-down'
            : 'border border-ink-200 bg-white text-ink-700 hover:border-ink-400 disabled:opacity-50'
        }`}
      >
        {state === 'saving' ? '保存中…' : state === 'done' ? '已记录' : '保存本次快照'}
      </button>
    </div>
  );
}
