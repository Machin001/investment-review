import Link from 'next/link';
import { listAssets, listDecisions } from '@/lib/store';
import PlanChecklist from '@/components/PlanChecklist';

export const dynamic = 'force-dynamic';

export default async function PlanPage() {
  const [assets, decisions] = await Promise.all([listAssets(), listDecisions()]);

  return (
    <main className="mx-auto max-w-[880px] px-8 py-12">
      <Link href="/" className="text-[12px] text-ink-400 hover:text-ink-700">
        ← 返回
      </Link>
      <h1 className="mt-3 text-[22px] font-medium text-ink-900">建仓前，先过一遍自己写的清单</h1>
      <p className="mt-2 max-w-[660px] text-[13px] leading-relaxed text-ink-500">
        复盘的价值不在看完那一刻，而在下一次下手之前。这里会把你过去复盘沉淀的结论调出来，
        按标的、板块、通用情境匹配，确认完才能记录这笔决策。
      </p>

      <div className="mt-4 flex gap-4 text-[11px] text-ink-400">
        <span>
          已沉淀资产 <span className="num text-ink-900">{assets.length}</span> 条
        </span>
        <span>
          历史决策记录 <span className="num text-ink-900">{decisions.length}</span> 条
        </span>
        {assets.length === 0 && (
          <span className="text-warnLine">还没有资产，先去完成一次复盘并点「存入我的清单」</span>
        )}
      </div>

      <PlanChecklist />

      <footer className="mt-10 border-t border-[#E9EDF2] pt-4 text-[10.5px] leading-relaxed text-ink-400">
        这个页面不判断该不该买，也不给出仓位建议。它只做一件事：把你过去用真金白银换来的结论，在你要重复同样的动作之前递到你面前。
      </footer>
    </main>
  );
}
