export default function Loading() {
  return (
    <main className="mx-auto max-w-[1080px] px-8 py-12">
      <div className="h-3 w-16 rounded bg-ink-100" />
      <div className="mt-4 h-6 w-56 rounded bg-ink-100" />
      <div className="mt-3 h-3 w-[520px] max-w-full rounded bg-ink-100" />
      <div className="mt-6 grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[68px] rounded-card border border-[#E3E8EE] bg-white" />
        ))}
      </div>
      <div className="mt-6 h-[76px] rounded-card border border-[#E3E8EE] bg-white" />
      <div className="mt-6 space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-[42px] rounded-card border border-[#E9EDF2] bg-white" />
        ))}
      </div>
      <p className="mt-6 text-[11px] text-ink-400">
        正在把每笔交易重新过一遍复盘（要调上游行情接口），首次进入约需数秒…
      </p>
    </main>
  );
}
