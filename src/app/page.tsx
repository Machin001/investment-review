/**
 * 临时状态页 —— 用于确认工程骨架与数据源配置就绪
 * 正式界面在 S3-S7 替换
 */

export default function Home() {
  const fuyaoReady = Boolean(process.env.FUYAO_API_KEY?.trim());
  const ifindReady = Boolean(process.env.IFIND_AUTH_TOKEN?.trim());

  const items = [
    { key: '数据契约', desc: '证据 / 交易 / 假设台账 / 归因 / 学习资产 类型定义', done: true },
    { key: '时点防火墙', desc: 'ms / date / none 三档精度判定 + 出口护栏', done: true },
    { key: '扶摇客户端', desc: '个股与指数日K、热榜、涨停统计', done: fuyaoReady },
    { key: 'iFinD 客户端', desc: '公告与资讯语义检索、板块区间涨跌', done: ifindReady },
    { key: '录入与时间线', desc: 'CSV 解析、假设台账、双轨时间线', done: false },
    { key: '归因与沉淀', desc: '收益分解、偏差规则库、清单与提醒卡', done: false },
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <p className="text-[12px] tracking-[0.18em] text-ink-400">投资决策复盘</p>
      <h1 className="mt-2 text-[26px] font-medium leading-snug text-ink-900">
        让决策留下痕迹，而不是只留下盈亏
      </h1>
      <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-ink-500">
        当前为工程骨架自检页。核心机制「时点防火墙」已完成并通过 15 项测试，
        数据源双通道已接通真实接口。
      </p>

      <div className="card mt-8 divide-y divide-[#EEF1F5]">
        {items.map((it) => (
          <div key={it.key} className="flex items-start gap-3 px-5 py-3.5">
            <span
              className={`mt-[7px] h-[6px] w-[6px] shrink-0 rounded-full ${
                it.done ? 'bg-down' : 'bg-ink-300'
              }`}
            />
            <div className="min-w-0">
              <div className="text-[13px] text-ink-900">{it.key}</div>
              <div className="text-[12px] text-ink-400">{it.desc}</div>
            </div>
            <span className="ml-auto shrink-0 text-[11px] text-ink-400">
              {it.done ? '就绪' : '待建设'}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-[11px]">
        <span
          className={`rounded border px-2 py-1 ${
            fuyaoReady ? 'border-down/30 bg-down/5 text-down' : 'border-warnLine/30 bg-warnSoft text-warnLine'
          }`}
        >
          扶摇凭证：{fuyaoReady ? '已配置' : '缺失'}
        </span>
        <span
          className={`rounded border px-2 py-1 ${
            ifindReady ? 'border-down/30 bg-down/5 text-down' : 'border-warnLine/30 bg-warnSoft text-warnLine'
          }`}
        >
          iFinD 凭证：{ifindReady ? '已配置' : '缺失'}
        </span>
      </div>
    </main>
  );
}
