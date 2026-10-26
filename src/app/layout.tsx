import type { Metadata } from 'next';
import './globals.css';
import { isSnapshotMode, snapshotRecordedAt } from '@/lib/providers/kv';
import { shanghaiDate } from '@/lib/time';

export const metadata: Metadata = {
  title: '复盘 · 让决策留下痕迹',
  description:
    '把交易记录、当时的理由与当时可见的市场信息对齐到一条时间线，区分事前可知与事后信息，拆出事实归因、行为偏差与不确定因素。',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const snapshot = isSnapshotMode();
  const recordedAt = snapshot ? await snapshotRecordedAt() : null;

  return (
    <html lang="zh-CN">
      <body>
        {snapshot && (
          <div className="border-b border-warnLine/30 bg-warnSoft px-4 py-1.5 text-center text-[11px] text-[#7A5310]">
            数据快照模式
            {recordedAt ? ` · 行情与公告截至 ${shanghaiDate(recordedAt)}` : ''}
            {' · '}
            当前环境未配置数据源凭证，页面展示的是本地录制的真实历史数据，不是实时行情
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
