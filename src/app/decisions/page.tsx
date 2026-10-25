import Link from 'next/link';
import { listDecisions } from '@/lib/store';
import { buildDecisionChecks, executionStats } from '@/lib/decision-check';
import { shanghaiDateTime } from '@/lib/time';
import DecisionCheckForm from '@/components/DecisionCheckForm';

export const dynamic = 'force-dynamic';

function pct(n: number | null): string {
  return n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const VERDICT_LABEL: Record<string, string> = {
  followed: '完全执行',
  partial: '部分执行',
  ignored: '没有执行',
};

const VERDICT_STYLE: Record<string, string> = {
  followed: 'border-down/40 bg-down/5 text-down',
  partial: 'border-warnLine/40 bg-warnSoft text-warnLine',
  ignored: 'border-up/40 bg-up/5 text-up',
};

export default async function DecisionsPage() {
  const decisions = await listDecisions();
  const views = await buildDecisionChecks(decisions);
  const stats = executionStats(views);

  return (
    <main className="mx-auto max-w-[980px] px-8 py-12">
      <Link href="/" className="text-[12px] text-ink-400 hover:text-ink-700">
        ← 返回
      </Link>
      <h1 className="mt-3 text-[22px] font-medium text-ink-900">决策回检</h1>
      <p className="mt-2 max-w-[660px] text-[13px] leading-relaxed text-ink-500">
        建仓前确认过的清单，事后到底有没有被执行？这里把决策之后的实际走势算出来，
        再请你自述执行情况。没有这一步，「清单有效」只是自我感觉。
      </p>

      <section className="mt-6 grid grid-cols-4 gap-3">
        {[
          { label: '已记录决策', value: String(stats.total) },
          { label: '已回检', value: `${stats.checked} / ${stats.total}` },
          {
            label: '清单完全执行率',
            value: stats.followedRate === null ? '—' : `${(stats.followedRate * 100).toFixed(0)}%`,
          },
          {
            label: '证伪条件被触及',
            value: stats.falsifyJudgeable === 0 ? '—' : `${stats.falsifyTriggeredCount} / ${stats.falsifyJudgeable}`,
          },
        ].map((k) => (
          <div key={k.label} className="rounded-card border border-[#E3E8EE] bg-white px-4 py-3">
            <div className="text-[11px] text-ink-400">{k.label}</div>
            <div className="num mt-1 text-[17px] text-ink-900">{k.value}</div>
          </div>
        ))}
      </section>

      {decisions.length === 0 && (
        <div className="mt-8 rounded-card border border-[#E3E8EE] bg-white p-6 text-center">
          <p className="text-[12.5px] text-ink-500">还没有决策记录。</p>
          <Link href="/plan" className="mt-2 inline-block text-[12px] text-accent hover:underline">
            去做一次建仓前检查 →
          </Link>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {views.map(({ decision: d, facts, gaps, dueForCheck }) => (
          <article key={d.id} className="rounded-card border border-[#E3E8EE] bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="text-[13.5px] text-ink-900">{d.name}</span>
                <span className="num ml-2 text-[11px] text-ink-400">{d.thscode}</span>
                <span className="ml-3 text-[11px] text-ink-400">
                  决策于 {shanghaiDateTime(d.createdAtMs)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {dueForCheck && (
                  <span className="rounded border border-warnLine/40 bg-warnSoft px-1.5 py-0.5 text-[10.5px] text-warnLine">
                    待回检
                  </span>
                )}
                {d.check && (
                  <span className={`rounded border px-1.5 py-0.5 text-[10.5px] ${VERDICT_STYLE[d.check.verdict]}`}>
                    {VERDICT_LABEL[d.check.verdict]}
                  </span>
                )}
                <span className="text-[10.5px] text-ink-400">确认清单 {d.checkedAssetIds.length} 条</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-5 gap-2">
              {[
                { label: '决策价', value: facts.basePrice === null ? '—' : facts.basePrice.toFixed(2), cls: 'text-ink-900' },
                {
                  label: `至今涨跌（${facts.asOfDate ?? '—'}）`,
                  value: pct(facts.returnPct),
                  cls: facts.returnPct === null ? 'text-ink-400' : facts.returnPct >= 0 ? 'text-up' : 'text-down',
                },
                {
                  label: '期间最大回撤',
                  value: pct(facts.maxDrawdownPct),
                  cls: facts.maxDrawdownPct === null ? 'text-ink-400' : 'text-down',
                },
                {
                  label: '经过交易日',
                  value: facts.tradingDays === null ? '—' : String(facts.tradingDays),
                  cls: 'text-ink-900',
                },
                {
                  label: '证伪阈值',
                  value:
                    facts.falsifyThreshold === null
                      ? '—'
                      : `${facts.falsifyThreshold}${facts.falsifyTriggered ? '（已触及）' : '（未触及）'}`,
                  cls:
                    facts.falsifyTriggered === null
                      ? 'text-ink-400'
                      : facts.falsifyTriggered
                        ? 'text-up'
                        : 'text-down',
                },
              ].map((k) => (
                <div key={k.label} className="rounded border border-[#EEF1F5] px-2.5 py-2">
                  <div className="text-[10px] text-ink-400">{k.label}</div>
                  <div className={`num mt-0.5 text-[12.5px] ${k.cls}`}>{k.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-2 text-[11px] text-ink-400">
              证伪条件：{d.falsify ?? <span className="text-warnLine">当时没写</span>}
              {d.falsify && facts.falsifyThreshold === null && (
                <span className="ml-1">（没有可解析的价格阈值，未自动判定）</span>
              )}
            </div>

            {d.check ? (
              <div className="mt-3 rounded-md border border-[#EEF1F5] bg-[#FAFBFC] px-3 py-2 text-[11.5px] leading-relaxed text-ink-600">
                已回检 · {shanghaiDateTime(d.check.checkedAtMs)} · 自述「{VERDICT_LABEL[d.check.verdict]}」
                {d.check.note && <div className="mt-1 text-ink-500">备注：{d.check.note}</div>}
                <div className="mt-1 text-[10.5px] text-ink-400">
                  涨跌与回撤为系统计算；执行情况为本人自述，两者分开记录
                </div>
              </div>
            ) : (
              <DecisionCheckForm decisionId={d.id} />
            )}

            {gaps.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[10.5px] text-warnLine">
                {gaps.map((g, i) => (
                  <li key={i}>
                    缺口 · {g.item}：{g.reason}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>

      <footer className="mt-8 border-t border-[#E9EDF2] pt-4 text-[10.5px] leading-relaxed text-ink-400">
        回检只回答两个问题：价格后来怎么走、你当时确认的清单有没有被执行。
        它不评价这笔决策对不对，也不给下一次的建议。
      </footer>
    </main>
  );
}
