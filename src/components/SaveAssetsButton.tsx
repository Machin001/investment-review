'use client';

import { useState } from 'react';
import type { LearningAsset } from '@/lib/types';

export default function SaveAssetsButton({ assets, sessionId }: { assets: LearningAsset[]; sessionId: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function save() {
    setState('saving');
    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? '保存失败');
      setState('done');
      setMsg(`已存入清单（${assets.length} 条）`);
    } catch (err) {
      setState('error');
      setMsg((err as Error).message);
    }
  }

  if (assets.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className={`text-[11px] ${state === 'error' ? 'text-up' : 'text-down'}`}>{msg}</span>
      )}
      <button
        onClick={save}
        disabled={state === 'saving' || state === 'done'}
        className={`rounded-md px-3 py-1.5 text-[12px] ${
          state === 'done'
            ? 'border border-down/30 bg-down/5 text-down'
            : 'bg-ink-900 text-white hover:bg-ink-700 disabled:opacity-50'
        }`}
        title={sessionId}
      >
        {state === 'saving' ? '保存中…' : state === 'done' ? '已存入我的清单' : '存入我的清单'}
      </button>
    </div>
  );
}
