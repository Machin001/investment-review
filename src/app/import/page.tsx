'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Trade } from '@/lib/types';

const SAMPLE = `成交日期,证券代码,证券名称,买卖标志,成交价格,成交数量,成交金额,手续费
2026-08-03,603986,兆易创新,证券买入,340.74,200,68148.00,20.44
2026-08-05,603986,兆易创新,证券卖出,385.44,200,77088.00,23.13
2026-09-15,600519,贵州茅台,证券卖出,1272.75,100,127275.00,76.37`;

interface PreviewResp {
  ok: boolean;
  error?: string;
  mapping?: Record<string, string>;
  parsedCount?: number;
  errors?: string[];
  preview?: Trade[];
  added?: number;
  total?: number;
}

const FIELD_LABEL: Record<string, string> = {
  tradedAt: '成交时间',
  thscode: '证券代码',
  name: '证券名称',
  side: '买卖方向',
  price: '成交价格',
  qty: '成交数量',
  amount: '成交金额',
  fee: '手续费',
};

export default function ImportPage() {
  const [csv, setCsv] = useState('');
  const [resp, setResp] = useState<PreviewResp | null>(null);
  const [loading, setLoading] = useState<'preview' | 'commit' | null>(null);
  const [done, setDone] = useState<{ added: number; total: number } | null>(null);

  async function run(mode: 'preview' | 'commit') {
    setLoading(mode);
    setDone(null);
    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, mode }),
      });
      const json = (await res.json()) as PreviewResp;
      setResp(json);
      if (mode === 'commit' && json.ok && json.added !== undefined && json.total !== undefined) {
        setDone({ added: json.added, total: json.total });
      }
    } catch (err) {
      setResp({ ok: false, error: (err as Error).message });
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="mx-auto max-w-[900px] px-8 py-12">
      <Link href="/" className="text-[12px] text-ink-400 hover:text-ink-700">
        ← 返回
      </Link>
      <h1 className="mt-3 text-[22px] font-medium text-ink-900">导入交割单</h1>
      <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-ink-500">
        从券商导出成交记录后直接粘贴。先点「解析预览」核对字段映射与逐行错误，
        确认无误再导入 —— 数字错一位，后面的归因全错。
      </p>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <label className="text-[12px] text-ink-700">粘贴 CSV / TSV</label>
          <button
            className="text-[11px] text-accent hover:underline"
            onClick={() => setCsv(SAMPLE)}
            type="button"
          >
            填入示例数据
          </button>
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={9}
          spellCheck={false}
          placeholder="成交日期,证券代码,证券名称,买卖标志,成交价格,成交数量,成交金额,手续费"
          className="mt-2 w-full rounded-card border border-[#DDE3EA] bg-white p-3 font-mono text-[11.5px] leading-relaxed text-ink-700 outline-none focus:border-accent"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => run('preview')}
            disabled={!csv.trim() || loading !== null}
            className="rounded-md border border-ink-200 px-3.5 py-2 text-[12px] text-ink-700 hover:border-ink-400 disabled:opacity-40"
          >
            {loading === 'preview' ? '解析中…' : '解析预览'}
          </button>
          <button
            onClick={() => run('commit')}
            disabled={!csv.trim() || loading !== null}
            className="rounded-md bg-ink-900 px-3.5 py-2 text-[12px] text-white hover:bg-ink-700 disabled:opacity-40"
          >
            {loading === 'commit' ? '导入中…' : '确认导入'}
          </button>
        </div>
      </div>

      {resp && !resp.ok && (
        <div className="mt-5 rounded-card border border-up/30 bg-up/5 px-4 py-3 text-[12px] text-up">
          导入失败：{resp.error}
          {resp.errors && resp.errors.length > 0 && (
            <ul className="mt-1.5 list-inside list-disc text-[11px]">
              {resp.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {done && (
        <div className="mt-5 rounded-card border border-down/30 bg-down/5 px-4 py-3 text-[12px] text-down">
          导入完成：新增 {done.added} 条，当前共 {done.total} 条交易。
          <Link href="/" className="ml-2 underline">
            回到列表
          </Link>
        </div>
      )}

      {resp?.ok && resp.mapping && (
        <div className="mt-5 rounded-card border border-[#E3E8EE] bg-white p-4">
          <div className="text-[12px] text-ink-900">
            字段映射（我这样理解你的表）
            <span className="ml-2 text-[11px] text-ink-400">共解析出 {resp.parsedCount} 条交易</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(resp.mapping).map(([k, v]) => (
              <span key={k} className="rounded border border-ink-200 px-1.5 py-0.5 text-[10.5px] text-ink-600">
                {FIELD_LABEL[k] ?? k} ← {v}
              </span>
            ))}
          </div>

          {resp.errors && resp.errors.length > 0 && (
            <div className="mt-3 rounded bg-warnSoft px-3 py-2 text-[11px] leading-relaxed text-[#7A5310]">
              {resp.errors.length} 行未通过校验，已跳过（不会静默丢弃）：
              <ul className="mt-1 list-inside list-disc">
                {resp.errors.slice(0, 6).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {resp.preview && resp.preview.length > 0 && (
            <table className="mt-3 w-full text-[11.5px]">
              <thead>
                <tr className="border-b border-[#EEF1F5] text-left text-[10.5px] text-ink-400">
                  <th className="py-1.5 font-normal">代码</th>
                  <th className="py-1.5 font-normal">名称</th>
                  <th className="py-1.5 font-normal">方向</th>
                  <th className="py-1.5 text-right font-normal">价格</th>
                  <th className="py-1.5 text-right font-normal">数量</th>
                  <th className="py-1.5 text-right font-normal">金额</th>
                </tr>
              </thead>
              <tbody>
                {resp.preview.map((t) => (
                  <tr key={t.id} className="border-b border-[#F4F6F9] last:border-0">
                    <td className="num py-1.5 text-ink-700">{t.thscode}</td>
                    <td className="py-1.5 text-ink-900">{t.name}</td>
                    <td className="py-1.5">{t.side === 'buy' ? '买入' : '卖出'}</td>
                    <td className="num py-1.5 text-right">{t.price}</td>
                    <td className="num py-1.5 text-right">{t.qty}</td>
                    <td className="num py-1.5 text-right">{t.amount.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </main>
  );
}
