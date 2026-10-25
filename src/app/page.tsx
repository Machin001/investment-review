import Link from 'next/link';
import { listPositions, listAssets, listDecisions } from '@/lib/store';
import { shanghaiDate } from '@/lib/time';
import { SEED_PROVENANCE } from '@/data/seed';

export const dynamic = 'force-dynamic';

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default async function Home() {
  const [positions, assets, decisions] = await Promise.all([listPositions(), listAssets(), listDecisions()]);
  const pendingChecks = decisions.filter((d) => d.check === null).length;
  const missingHypothesis = positions.filter((p) => p.hypothesis === null);
  const todos: { label: string; detail: string; href: string }[] = [
    ...(pendingChecks > 0
      ? [
          {
            label: `${pendingChecks} 条决策待回检`,
            detail: '建仓时确认的清单，事后有没有被执行？',
            href: '/decisions',
          },
        ]
      : []),
    ...missingHypothesis.map((p) => ({
      label: `${p.entry.name} 还没写假设台账`,
      detail: '没有证伪条件，这笔交易事后无法判断错在哪一步',
      href: `/hypothesis/${p.entry.id}`,
    })),
  ];

  return (
    <main className="mx-auto max-w-[1080px] px-8 py-12">
      <header>
        <div className="max-w-[700px]">
          <p className="text-[11px] tracking-[0.2em] text-ink-400">投资决策复盘</p>
          <h1 className="mt-2 text-[24px] font-medium leading-snug text-ink-900">
            你的交易记录在这里，当时的想法不在
          </h1>
          <p className="mt-2 max-w-[620px] text-[13px] leading-relaxed text-ink-500">
            这个工具把成交记录、当时可见的市场信息和你写下的假设对齐到一条时间线，
            先拦住事后才知道的信息，再拆开收益里哪部分来自市场、哪部分来自你的判断。
          </p>
        </div>
        <nav className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href="/patterns"
            className="rounded-md border border-ink-200 px-3.5 py-2 text-[12px] text-ink-700 hover:border-ink-400"
          >
            一组交易的共同点
          </Link>
          <Link
            href="/plan"
            className="rounded-md border border-ink-200 px-3.5 py-2 text-[12px] text-ink-700 hover:border-ink-400"
          >
            建仓前检查
          </Link>
          <Link
            href="/decisions"
            className={`rounded-md border px-3.5 py-2 text-[12px] hover:border-ink-400 ${
              pendingChecks > 0
                ? 'border-warnLine/40 bg-warnSoft text-[#7A5310]'
                : 'border-ink-200 text-ink-700'
            }`}
          >
            决策回检{pendingChecks > 0 ? ` · ${pendingChecks} 待回检` : ''}
          </Link>
          <Link
            href="/import"
            className="rounded-md border border-ink-200 px-3.5 py-2 text-[12px] text-ink-700 hover:border-ink-400"
          >
            导入交割单
          </Link>
        </nav>
      </header>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-medium text-ink-900">今日待办</h2>
          <span className="text-[11px] text-ink-400">{todos.length === 0 ? '无' : `${todos.length} 项`}</span>
        </div>
        {todos.length === 0 ? (
          <p className="mt-2 rounded-card border border-[#E3E8EE] bg-white px-4 py-3 text-[12px] text-ink-400">
            今天没有待办。台账齐全，也没有到期未回检的决策 —— 空着手比乱操作好。
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[#EEF1F5] overflow-hidden rounded-card border border-[#E3E8EE] bg-white">
            {todos.map((t) => (
              <li key={t.href}>
                <Link href={t.href} className="flex items-center gap-3 px-4 py-3 hover:bg-[#FAFBFC]">
                  <span className="mt-[7px] h-[6px] w-[6px] shrink-0 self-start rounded-full bg-warnLine" />
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-ink-900">{t.label}</div>
                    <div className="text-[11px] text-ink-400">{t.detail}</div>
                  </div>
                  <span className="ml-auto shrink-0 text-[11px] text-accent">去处理 →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-medium text-ink-900">待复盘持仓</h2>
          <span className="text-[11px] text-ink-400">{positions.length} 笔</span>
        </div>

        <div className="mt-3 overflow-hidden rounded-card border border-[#E3E8EE] bg-white">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#EEF1F5] text-left text-[11px] text-ink-400">
                <th className="px-4 py-2.5 font-normal">标的</th>
                <th className="px-4 py-2.5 font-normal">建仓</th>
                <th className="px-4 py-2.5 font-normal">卖出</th>
                <th className="px-4 py-2.5 text-right font-normal">价格涨跌</th>
                <th className="px-4 py-2.5 font-normal" title="按成交价计算，未含费用；含费用的收益在复盘页">假设台账</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {positions.map(({ entry, exit, hypothesis }) => {
                const ret = exit ? ((exit.price - entry.price) / entry.price) * 100 : null;
                return (
                  <tr key={entry.id} className="border-b border-[#F4F6F9] last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-ink-900">{entry.name}</div>
                      <div className="num text-[11px] text-ink-400">{entry.thscode}</div>
                    </td>
                    <td className="num px-4 py-3 text-ink-700">
                      {shanghaiDate(entry.tradedAtMs)} · {entry.price}
                    </td>
                    <td className="num px-4 py-3 text-ink-700">
                      {exit ? `${shanghaiDate(exit.tradedAtMs)} · ${exit.price}` : '—'}
                    </td>
                    <td
                      className={`num px-4 py-3 text-right ${
                        ret === null ? 'text-ink-400' : ret >= 0 ? 'text-up' : 'text-down'
                      }`}
                    >
                      {ret === null ? '未平仓' : pct(ret)}
                    </td>
                    <td className="px-4 py-3">
                      {hypothesis ? (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] ${
                            hypothesis.anchor === 'recall_only'
                              ? 'bg-warnSoft text-warnLine'
                              : 'bg-accent-soft text-accent-700'
                          }`}
                        >
                          {hypothesis.anchor === 'recall_only' ? '事后回忆' : '当时记录'}
                        </span>
                      ) : (
                        <Link href={`/hypothesis/${entry.id}`} className="text-[11px] text-accent hover:underline">
                          补写台账
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/review/${entry.id}?viewpoint=entry`}
                        className="text-[12px] text-accent hover:underline"
                      >
                        开始复盘 →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10 grid grid-cols-3 gap-4">
        <div className="rounded-card border border-[#E3E8EE] bg-white p-4">
          <div className="text-[12px] text-ink-900">已沉淀学习资产</div>
          <div className="num mt-1 text-[22px] text-ink-900">{assets.length}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            清单项、提醒卡与错误词典，会在下一次建仓时被调出来
          </p>
        </div>
        <div className="rounded-card border border-[#E3E8EE] bg-white p-4">
          <div className="text-[12px] text-ink-900">核心机制</div>
          <div className="mt-1 text-[13px] text-ink-700">时点防火墙</div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            事后信息在数据流层面进不了「当时的我」，不是靠界面折叠
          </p>
        </div>
        <div className="rounded-card border border-[#E3E8EE] bg-white p-4">
          <div className="text-[12px] text-ink-900">数据来源</div>
          <div className="mt-1 text-[11px] leading-relaxed text-ink-500">{SEED_PROVENANCE}</div>
        </div>
      </section>
    </main>
  );
}
