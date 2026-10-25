import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '复盘 · 让决策留下痕迹',
  description:
    '把交易记录、当时的理由与当时可见的市场信息对齐到一条时间线，区分事前可知与事后信息，拆出事实归因、行为偏差与不确定因素。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
