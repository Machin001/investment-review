import Link from 'next/link';
import { buildPatterns, dispositionVerdict, totalBiasCount } from '@/lib/patterns';
import { listSnapshots } from '@/lib/store';
import { shanghaiDate } from '@/lib/time';
import SaveSnapshotButton from '@/components/SaveSnapshotButton';

export const dynamic = 'force-dynamic';

function pct(n: number | null): string {
  return n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default async function PatternsPage() {
  const [r, snapshots] = await Promise.all([buildPatterns(), listSnapshots()]);
  const dv = dispositionVerdict(r);
  const maxBias = Math.max(1, ...snapshots.map(totalBiasCount));

  return (
    <main className="mx-auto max-w-[1080px] px-8 py-12">
      <Link href="/" className="text-[12px] text-ink-400 hover:text-ink-700">
        ← 返回
      </Link>
      <h1 className="mt-3 text-[22px] font-medium text-ink-900">一组交易的共同点</h1>
      <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-ink-500">
        单笔复盘告诉你「这一次错在哪」，这里回答「我是不是一直在犯同一个错」。
        下面的数字全部由各笔复盘会话的归因与规则命中聚合而来，不是模型总结的。
      </p>

      <section className="mt-6 grid grid-cols-4 gap-3">
        {[
          { label: '已复盘交易', value: `${r.closedPositions} / ${r.totalPositions}`, cls: 'text-ink-900' },
          {
            label: '胜率（含费用口径）',
            value: r.winRate === null ? '—' : `${(r.winRate * 100).toFixed(0)}%`,
            cls: 'text-ink-900',
          },
          {
            label: '平均区间收益',
            value: pct(r.avgReturnPct),
            cls: r.avgReturnPct !== null && r.avgReturnPct >= 0 ? 'text-up' : 'text-down',
          },
          {
            label: '盈/亏 持有交易日比',
            value: r.dispositionRatio === null ? '—' : r.dispositionRatio.toFixed(2),
            cls: 'text-ink-900',
          },
        ].map((k) => (
          <div key={k.label} className="rounded-card border border-[#E3E8EE] bg-white px-4 py-3">
            <div className="text-[11px] text-ink-400">{k.label}</div>
            <div className={`num mt-1 text-[17px] ${k.cls}`}>{k.value}</div>
          </div>
        ))}
      </section>

      <section className="mt-6">
        <div
          className={`rounded-card border px-4 py-3 text-[12px] leading-relaxed ${
            dv.verdict === 'hit'
              ? 'border-up/30 bg-up/5 text-up'
              : dv.verdict === 'clear'
                ? 'border-down/30 bg-down/5 text-down'
                : 'border-warnLine/30 bg-warnSoft text-[#7A5310]'
          }`}
        >
          <span className="font-medium">
            处置效应：{dv.verdict === 'hit' ? '命中' : dv.verdict === 'clear' ? '未命中' : '样本不足'}
          </span>
          <span className="ml-2">{dv.text}</span>
          <span className="mt-1 block text-[10.5px] opacity-70">
            判定条件：(盈利单平均持有交易日 / 亏损单平均持有交易日) &lt; 0.5，且两边样本均不为空
          </span>
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-medium text-ink-900">偏差趋势</h2>
          <SaveSnapshotButton />
        </div>
        <p className="mt-1 text-[11px] text-ink-400">
          快照是对「当时」的固定记录。样本会随交易增加而变化，只看命中笔数会被样本量带偏，
          所以同时列出已平仓笔数、处置效应比与胜率。
        </p>

        <div className="mt-3 overflow-hidden rounded-card border border-[#E3E8EE] bg-white">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#EEF1F5] text-left text-[11px] text-ink-400">
                <th className="px-4 py-2 font-normal">快照日期</th>
                <th className="px-4 py-2 font-normal">已平仓</th>
                <th className="px-4 py-2 font-normal">偏差总命中</th>
                <th className="px-4 py-2 font-normal">处置效应比</th>
                <th className="px-4 py-2 text-right font-normal">胜率</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-[11px] text-ink-400">
                    还没有快照。点右上角「保存本次快照」，以后就能看到偏差有没有变化。
                  </td>
                </tr>
              )}
              {snapshots.map((sn) => (
                <tr key={sn.id} className="border-b border-[#F4F6F9] last:border-0">
                  <td className="num px-4 py-2.5 text-ink-700">
                    {shanghaiDate(sn.atMs)}
                    {sn.isDemo && (
                      <span className="ml-1.5 rounded border border-ink-300 bg-ink-100 px-1 text-[9.5px] text-ink-500">
                        演示
                      </span>
                    )}
                  </td>
                  <td className="num px-4 py-2.5 text-ink-500">{sn.totalPositions}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-[5px] w-[110px] rounded bg-ink-100">
                        <div
                          className="h-[5px] rounded bg-ink-400"
                          style={{ width: `${(totalBiasCount(sn) / maxBias) * 100}%` }}
                        />
                      </div>
                      <span className="num text-[11px] text-ink-600">{totalBiasCount(sn)}</span>
                    </div>
                  </td>
                  <td className="num px-4 py-2.5 text-ink-500">
                    {sn.dispositionRatio === null ? '—' : sn.dispositionRatio.toFixed(2)}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-ink-500">
                    {sn.winRate === null ? '—' : `${(sn.winRate * 100).toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-400">
          标「演示」的是构造数据，用于展示趋势形态；真实快照由你点按钮生成，两者不混排统计。
        </p>
      </section>

      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-medium text-ink-900">反复出现的偏差</h2>
          <span className="text-[10.5px] text-ink-400">分母为纳入统计的全部交易（含未平仓），分子为命中笔数</span>
        </div>
        <div className="mt-3 overflow-hidden rounded-card border border-[#E3E8EE] bg-white">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#EEF1F5] text-left text-[11px] text-ink-400">
                <th className="px-4 py-2.5 font-normal">偏差</th>
                <th className="px-4 py-2.5 font-normal" title="分子为命中该偏差的笔数，分母为纳入统计的全部交易（含未平仓）">
                  命中笔数
                </th>
                <th className="px-4 py-2.5 font-normal">涉及标的</th>
                <th className="px-4 py-2.5 font-normal">判定规则</th>
              </tr>
            </thead>
            <tbody>
              {r.biasRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-[11.5px] text-ink-400">
                    暂无命中记录。
                  </td>
                </tr>
              )}
              {r.biasRows.map((b) => (
                <tr key={b.code} className="border-b border-[#F4F6F9] last:border-0">
                  <td className="px-4 py-3 text-ink-900">{b.label}</td>
                  <td className="num px-4 py-3 text-ink-700">
                    {b.count} / {b.total}
                  </td>
                  <td className="px-4 py-3 text-ink-500">{b.symbols.join('、')}</td>
                  <td className="px-4 py-3 text-[11px] text-ink-400">{b.rules[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-[14px] font-medium text-ink-900">逐笔一览</h2>
        <div className="mt-3 overflow-hidden rounded-card border border-[#E3E8EE] bg-white">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#EEF1F5] text-left text-[11px] text-ink-400">
                <th className="px-4 py-2.5 font-normal">标的</th>
                <th className="px-4 py-2.5 text-right font-normal">区间收益</th>
                <th className="px-4 py-2.5 text-right font-normal">持有交易日</th>
                <th className="px-4 py-2.5 font-normal">命中偏差</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {r.perPosition.map((p) => (
                <tr key={p.id} className="border-b border-[#F4F6F9] last:border-0">
                  <td className="px-4 py-3">
                    <div className="text-ink-900">{p.name}</div>
                    <div className="num text-[11px] text-ink-400">{p.thscode}</div>
                  </td>
                  <td
                    className={`num px-4 py-3 text-right ${
                      p.returnPct === null ? 'text-ink-400' : p.returnPct >= 0 ? 'text-up' : 'text-down'
                    }`}
                  >
                    {pct(p.returnPct)}
                  </td>
                  <td className="num px-4 py-3 text-right text-ink-700">{p.holdDays ?? '—'}</td>
                  <td className="px-4 py-3 text-[11.5px] text-ink-500">
                    {p.biasLabels.length ? p.biasLabels.join('、') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/review/${p.id}?viewpoint=today`} className="text-[11.5px] text-accent hover:underline">
                      查看复盘 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {r.gaps.length > 0 && (
        <section className="mt-6 rounded-card border border-warnLine/25 bg-warnSoft/40 p-4">
          <div className="text-[12px] text-[#7A5310]">统计口径说明与缺口</div>
          <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-[#7A5310]">
            {r.gaps.map((g, i) => (
              <li key={i}>
                <span className="font-medium">{g.item}</span>：{g.reason}（影响：{g.impact}）
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t border-[#E9EDF2] pt-4 text-[10.5px] text-ink-400">
        持有期一律按交易日计（依赖交易日历），收益按含双边费用的口径。样本不足时不给结论。
      </footer>
    </main>
  );
}
