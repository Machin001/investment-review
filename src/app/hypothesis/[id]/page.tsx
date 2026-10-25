import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPosition } from '@/lib/store';
import { shanghaiDateTime } from '@/lib/time';
import HypothesisForm from '@/components/HypothesisForm';

export const dynamic = 'force-dynamic';

export default async function HypothesisPage({ params }: { params: { id: string } }) {
  const pos = await getPosition(params.id);
  if (!pos) notFound();

  const { entry, hypothesis } = pos;

  return (
    <main className="mx-auto max-w-[760px] px-8 py-12">
      <Link href="/" className="text-[12px] text-ink-400 hover:text-ink-700">
        ← 返回
      </Link>

      <h1 className="mt-3 text-[22px] font-medium text-ink-900">把这笔交易的判断写下来</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
        {entry.name} · {shanghaiDateTime(entry.tradedAtMs)} 买入 @ {entry.price}
      </p>

      <div className="mt-4 rounded-card border border-warnLine/25 bg-warnSoft/60 px-4 py-3 text-[11.5px] leading-relaxed text-[#7A5310]">
        你现在是<span className="font-medium">事后补写</span>。系统会记录写下这条理由的时间，
        并向你确认「当时是什么时候写的」——晚于决策 24 小时的台账会被标记为<span className="font-medium">事后回忆</span>，
        不计入归因权重。这不是为了扣分，而是因为被结果污染过的记忆，不能用来证明当时的判断。
      </div>

      <HypothesisForm
        tradeId={entry.id}
        tradeLabel={entry.name}
        initial={hypothesis}
      />
    </main>
  );
}
