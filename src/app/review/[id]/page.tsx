import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPosition } from '@/lib/store';
import { buildReview } from '@/lib/review';
import type { Viewpoint } from '@/lib/review';
import { shanghaiDate, shanghaiDateTime } from '@/lib/time';
import type { Evidence } from '@/lib/types';
import SaveAssetsButton from '@/components/SaveAssetsButton';

export const dynamic = 'force-dynamic';

const LEVEL_STYLE: Record<string, string> = {
  A: 'border-down/30 bg-down/5 text-down',
  B: 'border-warnLine/30 bg-warnSoft text-warnLine',
  C: 'border-ink-300/40 bg-ink-100 text-ink-500',
};

const VERDICT_STYLE: Record<string, string> = {
  visible: 'text-ink-400',
  after: 'text-warnLine',
  uncertain: 'text-warnLine',
  unknown_time: 'text-ink-400',
};

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/** 时间线只展示关键节点：非行情证据全留，行情 K 线只留截止日前 8 根 */
function compactTimeline(list: Evidence[]): Evidence[] {
  const others = list.filter((e) => e.type !== 'price' && e.type !== 'index');
  const prices = list.filter((e) => e.type === 'price');
  const idx = list.filter((e) => e.type === 'index');
  return [...others, ...prices.slice(-8), ...idx.slice(-2)].sort((a, b) => {
    const ta = a.publishedAtMs ?? 0;
    const tb = b.publishedAtMs ?? 0;
    return ta - tb;
  });
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { viewpoint?: string };
}) {
  const pos = await getPosition(params.id);
  if (!pos) notFound();

  const vp = (searchParams.viewpoint ?? 'entry') as Viewpoint;
  const viewpoint: Viewpoint = ['entry', 'exit', 'today'].includes(vp) ? vp : 'entry';

  const payload = await buildReview({
    entry: pos.entry,
    exit: pos.exit,
    hypothesis: pos.hypothesis,
    viewpoint,
  });

  const a = payload.attribution;
  const timeline = compactTimeline(payload.visible);
  const afterList = compactTimeline(payload.after);
  const tabs: { key: Viewpoint; label: string; hint: string }[] = [
    { key: 'entry', label: '买入时的我', hint: '截止到买入成交那一刻' },
    { key: 'exit', label: '卖出时的我', hint: '截止到卖出成交那一刻' },
    { key: 'today', label: '今天回看', hint: '包含全部信息' },
  ];

  const attrRows = a
    ? [
        { key: '市场 β', value: a.marketPct, note: '基准指数同期收益 × β' },
        { key: '行业超额', value: a.sectorPct, note: '板块收益 − 基准收益' },
        { key: '执行偏差', value: a.executionPct, note: '实际成交 vs 收盘价买入持有' },
        { key: '残差', value: a.unexplainedPct, note: '未被以上各项解释的部分' },
      ]
    : [];
  const maxAbs = Math.max(1, ...attrRows.map((r) => Math.abs(r.value)));

  return (
    <main className="mx-auto max-w-[1180px] px-8 py-10">
      <div className="flex items-center gap-3 text-[12px] text-ink-400">
        <Link href="/" className="hover:text-ink-700">
          ← 返回
        </Link>
        <span>/</span>
        <span className="num">{payload.entry.thscode}</span>
      </div>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-medium text-ink-900">
            {payload.entry.name}
            <span className="ml-2 text-[13px] font-normal text-ink-400">
              {shanghaiDate(payload.entry.tradedAtMs)} 买入
              {payload.exit ? ` → ${shanghaiDate(payload.exit.tradedAtMs)} 卖出` : ' · 持有中'}
            </span>
          </h1>
          <p className="mt-1.5 text-[12px] text-ink-500">
            视角：<span className="text-ink-900">{payload.cutoffLabel}</span>
            <span className="num ml-2 text-ink-400">{shanghaiDateTime(payload.cutoffMs)}</span>
            <span className="ml-3 text-ink-400">
              数据完整度 {Math.round(payload.completeness * 100)}%（可见证据中 A 级占比）
            </span>
          </p>
        </div>

        <nav className="flex gap-1 rounded-md border border-ink-200 bg-white p-1">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/review/${params.id}?viewpoint=${t.key}`}
              title={t.hint}
              className={`rounded px-3 py-1.5 text-[12px] ${
                viewpoint === t.key ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-900'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* KPI */}
      <section className="mt-6 grid grid-cols-5 gap-3">
        {[
          { label: '买入价', value: payload.entry.price.toFixed(2), cls: 'text-ink-900' },
          { label: '卖出价', value: payload.exit ? payload.exit.price.toFixed(2) : '—', cls: 'text-ink-900' },
          {
            label: '区间收益（含费用）',
            value: a ? pct(a.totalReturnPct) : '—',
            cls: a ? (a.totalReturnPct >= 0 ? 'text-up' : 'text-down') : 'text-ink-400',
          },
          {
            label: '持有交易日',
            value: a?.inputs['持有交易日'].value != null ? String(a.inputs['持有交易日'].value) : '—',
            cls: 'text-ink-900',
          },
          {
            label: '仓位占比',
            value: payload.entry.positionWeight != null ? `${(payload.entry.positionWeight * 100).toFixed(0)}%` : '—',
            cls: 'text-ink-900',
          },
        ].map((k) => (
          <div key={k.label} className="rounded-card border border-[#E3E8EE] bg-white px-4 py-3">
            <div className="text-[11px] text-ink-400">{k.label}</div>
            <div className={`num mt-1 text-[17px] ${k.cls}`}>{k.value}</div>
          </div>
        ))}
      </section>

      {payload.meta.decisionDayNote && (
        <div className="mt-4 rounded-card border border-warnLine/30 bg-warnSoft px-4 py-3 text-[12px] leading-relaxed text-[#7A5310]">
          <span className="font-medium">决策时点的盘面是空白，这是数据边界：</span>
          {payload.meta.decisionDayNote}
        </div>
      )}

      <div className="mt-6 grid grid-cols-[1.35fr_1fr] gap-5">
        {/* 左：时间线 */}
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[14px] font-medium text-ink-900">当时可见的证据</h2>
            <span className="text-[11px] text-ink-400">{payload.visible.length} 条 · 已过时点防火墙</span>
          </div>

          <ol className="mt-3 space-y-1.5">
            {timeline.map((e) => {
              const j = payload.judgements[e.id];
              return (
                <li key={e.id} className="rounded-card border border-[#E9EDF2] bg-white px-4 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className={`num w-[86px] shrink-0 pt-0.5 text-[11px] ${VERDICT_STYLE[j?.verdict ?? 'visible']}`}>
                      {e.publishedAtMs ? shanghaiDateTime(e.publishedAtMs).slice(5) : e.publishedDate}
                    </span>
                    <span
                      className={`mt-0.5 shrink-0 rounded border px-1 text-[10px] leading-[16px] ${
                        LEVEL_STYLE[e.level] ?? LEVEL_STYLE.B
                      }`}
                    >
                      {e.level}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] text-ink-900">{e.title}</div>
                      <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink-500">{e.summary}</div>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[10.5px] text-ink-400 hover:text-accent">
                          溯源：{e.source.endpoint}
                        </summary>
                        <div className="mt-1.5 rounded bg-ink-50 p-2 text-[10.5px] leading-relaxed text-ink-500">
                          <div>判定：{j?.reason ?? '—'}</div>
                          {e.source.caliber && <div className="mt-1">口径：{e.source.caliber}</div>}
                          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] text-ink-400">
                            {JSON.stringify(e.raw ?? {}, null, 1).slice(0, 900)}
                          </pre>
                        </div>
                      </details>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* 后视镜 */}
          <details className="mt-4 rounded-card border border-dashed border-ink-300 bg-white/60 px-4 py-3">
            <summary className="cursor-pointer text-[12px] text-ink-700">
              后视镜区 · 决策之后才公开的 {payload.after.length} 条
              <span className="ml-2 text-[11px] text-ink-400">默认折叠，不计入任何归因</span>
            </summary>
            <ul className="mt-2 space-y-1">
              {afterList.slice(-12).map((e) => (
                <li key={e.id} className="flex gap-2 text-[11.5px] text-ink-500">
                  <span className="num w-[76px] shrink-0 text-ink-300">
                    {e.publishedAtMs ? shanghaiDateTime(e.publishedAtMs).slice(5) : e.publishedDate}
                  </span>
                  <span className="truncate">{e.title}</span>
                </li>
              ))}
            </ul>
          </details>

          {(payload.uncertain.length > 0 || payload.unknownTime.length > 0) && (
            <details className="mt-2 rounded-card border border-warnLine/25 bg-warnSoft/50 px-4 py-3">
              <summary className="cursor-pointer text-[12px] text-[#7A5310]">
                时点不确定 {payload.uncertain.length + payload.unknownTime.length} 条（同日只有日期 / 无时间信息）
              </summary>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#7A5310]">
                数据源只提供日期，分不清盘前盘后。按保守原则既不算「可见」也不算「事后」，单独列出且不计权重。
              </p>
              <ul className="mt-1.5 space-y-1">
                {[...payload.uncertain, ...payload.unknownTime].map((e) => (
                  <li key={e.id} className="text-[11.5px] text-[#7A5310]">
                    {e.publishedDate ?? '无日期'} · {e.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* 右：归因与偏差 */}
        <section className="space-y-5">
          <div>
            <h2 className="text-[14px] font-medium text-ink-900">收益归因</h2>
            {a ? (
              <div className="mt-3 rounded-card border border-[#E3E8EE] bg-white p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-ink-400">区间收益</span>
                  <span className={`num text-[20px] ${a.totalReturnPct >= 0 ? 'text-up' : 'text-down'}`}>
                    {pct(a.totalReturnPct)}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {attrRows.map((r) => (
                    <div key={r.key}>
                      <div className="flex items-baseline justify-between text-[11.5px]">
                        <span className="text-ink-700">{r.key}</span>
                        <span className={`num ${r.value >= 0 ? 'text-up' : 'text-down'}`}>{pct(r.value)}</span>
                      </div>
                      <div className="mt-1 h-[5px] w-full rounded bg-ink-100">
                        <div
                          className={`h-[5px] rounded ${r.value >= 0 ? 'bg-up/70' : 'bg-down/70'}`}
                          style={{ width: `${Math.min(100, (Math.abs(r.value) / maxAbs) * 100)}%` }}
                        />
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-ink-400">{r.note}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 border-t border-[#EEF1F5] pt-2 text-[10.5px] leading-relaxed text-ink-400">
                  β = {String(a.inputs['β'].value ?? '—')}（
                  {String(a.inputs['β样本交易日数'].value ?? '—')} 个交易日回归）；基准
                  {payload.meta.benchmark}；板块收益 {String(a.inputs['板块区间收益'].value ?? '缺失')}
                  {a.inputs['板块区间收益'].sourceEvidenceIds.length > 0 && (
                    <span className="ml-1 text-accent">可溯源</span>
                  )}
                </div>
                {a.degraded.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-[10.5px] text-warnLine">
                    {a.degraded.map((d, i) => (
                      <li key={i}>
                        降级 · {d.item}：{d.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-3 rounded-card border border-[#E3E8EE] bg-white p-4 text-[11.5px] text-ink-400">
                该笔尚未平仓或数据不足，无法计算区间归因。
              </p>
            )}
          </div>

          <div>
            <h2 className="text-[14px] font-medium text-ink-900">行为偏差</h2>
            <div className="mt-3 space-y-2">
              {payload.biasHits.length === 0 && (
                <p className="rounded-card border border-[#E3E8EE] bg-white p-4 text-[11.5px] text-ink-400">
                  本次未命中规则库中的偏差。这不等于决策正确，只说明规则库覆盖的场景没出现。
                </p>
              )}
              {payload.biasHits.map((h) => (
                <div key={h.code} className="rounded-card border border-[#E3E8EE] bg-white px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] text-ink-900">{h.label}</span>
                    <span className="text-[10px] text-ink-400">
                      {h.lowSample ? '样本不足' : `样本 ${h.sampleSize}`}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-700">{h.evidenceText}</p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10.5px] text-ink-400 hover:text-accent">判定规则</summary>
                    <div className="mt-1 rounded bg-ink-50 p-2 text-[10.5px] text-ink-500">
                      {h.rule}
                      {h.evidenceIds.length > 0 && (
                        <div className="mt-1 text-ink-400">证据：{h.evidenceIds.join('、')}</div>
                      )}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* 缺口与冲突 */}
      {(payload.gaps.length > 0 || payload.conflicts.length > 0) && (
        <section className="mt-8">
          <h2 className="text-[14px] font-medium text-ink-900">数据缺口与冲突</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-card border border-warnLine/25 bg-warnSoft/40 p-4">
              <div className="text-[12px] text-[#7A5310]">缺口 {payload.gaps.length} 项（均已在结论中降级标注）</div>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-[#7A5310]">
                {payload.gaps.map((g, i) => (
                  <li key={i}>
                    <span className="font-medium">{g.item}</span>：{g.reason}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-card border border-[#E3E8EE] bg-white p-4">
              <div className="text-[12px] text-ink-900">冲突 {payload.conflicts.length} 组</div>
              {payload.conflicts.length === 0 ? (
                <p className="mt-2 text-[11px] text-ink-400">本次未发现同指标多源不一致。</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-[11px] text-ink-700">
                  {payload.conflicts.map((c) => (
                    <li key={c.id}>
                      {c.date} · {c.metricKey}：
                      {c.values.map((v) => `${v.value}（${v.source.split('/').pop()}）`).join(' vs ')} —— 均保留
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 沉淀 */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-medium text-ink-900">这次复盘能留下的东西</h2>
          <SaveAssetsButton assets={payload.assets} sessionId={payload.sessionId} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {['checklist_item', 'reminder_card', 'error_dictionary'].map((kind) => {
            const list = payload.assets.filter((x) => x.kind === kind);
            const title =
              kind === 'checklist_item' ? '决策检查清单' : kind === 'reminder_card' ? '决策前提醒卡' : '个人错误词典';
            return (
              <div key={kind} className="rounded-card border border-[#E3E8EE] bg-white p-4">
                <div className="text-[12px] text-ink-900">{title}</div>
                {list.length === 0 ? (
                  <p className="mt-2 text-[11px] text-ink-400">本次没有产出这一类条目。</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {list.map((x) => (
                      <li key={x.id} className="text-[11.5px] leading-relaxed text-ink-700">
                        {x.content}
                        <span className="mt-0.5 block text-[10.5px] text-ink-400">触发：{x.trigger}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <footer className="mt-10 border-t border-[#E9EDF2] pt-4 text-[10.5px] leading-relaxed text-ink-400">
        本页只呈现事实与你自己写下的规则，不预测涨跌、不给出买卖建议。
        所有数字均可点开「溯源」查看来源接口、统计口径与原始字段。
      </footer>
    </main>
  );
}
