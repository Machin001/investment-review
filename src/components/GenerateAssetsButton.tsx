'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GenerateAssetsButton({ label = '从我的复盘生成清单' }: { label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function run() {
    setState('running');
    setMsg('');
    try {
      const res = await fetch('/api/assets/generate', { method: 'POST' });
      const json = (await res.json()) as { ok: boolean; added?: number; error?: string };
      if (!json.ok) throw new Error(json.error ?? '生成失败');
      setState('done');
      setMsg(`已生成 ${json.added} 条`);
      router.refresh();
    } catch (err) {
      setState('error');
      setMsg((err as Error).message);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={state === 'running' || state === 'done'}
        className={`rounded-md px-3 py-1.5 text-[11.5px] ${
          state === 'done'
            ? 'border border-down/30 bg-down/5 text-down'
            : 'border border-ink-200 bg-white text-ink-700 hover:border-ink-400 disabled:opacity-50'
        }`}
      >
        {state === 'running' ? '生成中…' : state === 'done' ? '已生成' : label}
      </button>
      {msg && <span className={`text-[11px] ${state === 'error' ? 'text-up' : 'text-down'}`}>{msg}</span>}
    </span>
  );
}
