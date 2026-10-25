/**
 * 数据契约 · 投资决策复盘
 *
 * 设计原则
 * 1. 每条证据必须能回答三个问题：从哪来（source）、什么时候公开的（时间三件套）、可信到什么程度（level）。
 * 2. 所有时间统一用毫秒 Unix 时间戳（Asia/Shanghai 语义），日期用 `yyyy-MM-dd` 字符串。
 * 3. 拿不到精确时间时，绝不猜 —— 降级为 date / none 精度，交给时点防火墙判为「不确定」。
 */

/** 数据来源通道 */
export type ProviderName = 'fuyao' | 'ifind' | 'user' | 'derived';

/**
 * 证据等级
 * A 级：有精确到毫秒/分钟的公开时间，可被时点防火墙严格判定
 * B 级：只有日期粒度，同日无法判断盘前盘后 —— 默认折叠、不计入归因权重
 * C 级：用户事后陈述（回忆），可能已被结果污染
 */
export type EvidenceLevel = 'A' | 'B' | 'C';

/** 时间精度 —— 决定防火墙能判到多细 */
export type TimePrecision = 'ms' | 'date' | 'none';

/** 证据类型 */
export type EvidenceType =
  | 'price' // 行情 K 线
  | 'snapshot' // 当日快照
  | 'index' // 指数行情
  | 'sector' // 行业 / 板块涨跌
  | 'limit_up_stat' // 涨停统计（市场情绪）
  | 'hot_rank' // 同花顺热榜排名
  | 'anomaly' // 个股异动解读
  | 'notice' // 公告
  | 'news' // 资讯
  | 'financial' // 财务数据
  | 'user_note'; // 用户陈述

/** 来源可追溯信息 —— 每个数字都要能回到这里 */
export interface EvidenceSource {
  provider: ProviderName;
  /** 具体接口或工具名，如 `GET /api/a-share/prices/historical` 或 `ifind:news.search_notice` */
  endpoint: string;
  /** 服务端返回的 request_id / 调用 id，用于对账 */
  requestId?: string;
  /** 抓取时刻（不是发布时间），用于区分「数据何时被取回」 */
  fetchedAtMs: number;
  /** 统计口径说明，如「月涨跌幅（月频指标）」「区间涨跌幅（总市值加权平均）」 */
  caliber?: string;
}

/** 证据 —— 时间线上的最小单元 */
export interface Evidence {
  id: string;
  type: EvidenceType;
  level: EvidenceLevel;
  title: string;
  /** 一句话摘要，供时间线与卡片展示 */
  summary: string;
  /** 相关标的 thscode，市场级证据可为空 */
  symbol?: string;

  /** 精确发布时间（毫秒）；无则为 null */
  publishedAtMs: number | null;
  /** 仅有日期时的 `yyyy-MM-dd`；有精确时间时也填，便于按日聚合 */
  publishedDate: string | null;
  timePrecision: TimePrecision;

  source: EvidenceSource;
  /** 原始字段快照，供「点开到原始字段」使用 */
  raw?: Record<string, unknown>;
  /**
   * 可比较的数值指标 —— 跨源冲突检测的唯一依据。
   * 没有 metric 的证据不参与冲突比对（避免用正则从摘要里猜数）。
   */
  metric?: { key: string; value: number; unit: string };
  /** 数据冲突标记：同一事实多个来源不一致时，两条都保留并互指 */
  conflictWith?: string[];
}

/** 时点防火墙判定结果 */
export type VisibilityVerdict =
  | 'visible' // 在决策时点之前公开，当时可判断
  | 'after' // 决策之后才公开 —— 事后信息，禁止进入当时视图
  | 'uncertain' // 同日但只有日期精度，无法判断盘前/盘后
  | 'unknown_time'; // 完全没有时间信息

export interface VisibilityJudgement {
  verdict: VisibilityVerdict;
  /** 人类可读的判定理由，会直接展示给用户 */
  reason: string;
  /** 是否计入归因权重（只有 visible 且 A/B 级为 true） */
  countable: boolean;
}

/** 交易记录 —— 复盘锚点 */
export interface Trade {
  id: string;
  thscode: string;
  name: string;
  side: 'buy' | 'sell';
  /** 成交时间，精确到分钟；这是整条时间线的锚点 T0 */
  tradedAtMs: number;
  price: number;
  qty: number;
  amount: number;
  fee: number;
  /** 同一标的的建仓/清仓分组，用于配对买卖 */
  positionId: string;
  /** 录入来源 */
  entrySource: 'csv' | 'form' | 'seed';
  /** 组合上下文：这笔占当时总仓位比例（0-1），用于判过度集中 */
  positionWeight?: number;
  /**
   * 所属行业（iFinD 行业分类路径），用于行业超额归因。
   * 必须与标的匹配；缺失时行业归因整项降级，不允许拿别的行业凑数。
   */
  sectorQuery?: string;
}

/**
 * 假设台账的「可信锚」分级
 * contemporaneous  录入时刻早于决策时点 + 缓冲（确实是当时写的）
 * evidence_backed  事后补写，但理由中的触发条件能与当时可见的 A/B 级证据交叉印证
 * recall_only      纯事后回忆，可能已被结果污染
 */
export type HypothesisAnchor = 'contemporaneous' | 'evidence_backed' | 'recall_only';

/** 假设台账 —— 「还原决策过程」的核心载体，不是「为什么买」 */
export interface Hypothesis {
  /** 一句话：你认为接下来会发生什么 */
  claim: string;
  /** 触发条件：什么信号出现你才认为假设在成立 */
  trigger: string;
  /** 证伪条件：什么情况下你承认自己错了（必填，这是复盘能否成立的前提） */
  falsify: string;
  /** 预期周期（交易日）。注意单位是交易日，对账时必须用交易日历，不能用自然日 */
  horizonTradingDays: number | null;
  /** 预期收益区间，百分比；null 表示用户未给 */
  expectedRangePct: [number, number] | null;
  /** 反方观点：你认为最有道理的反驳是什么 */
  counterView: string;
  /** 建档方式 */
  authoredBy: 'user' | 'ai_assisted' | 'ai_generated';
  /** 建立时刻 —— 用于识别「这条假设是不是事后补写的」 */
  createdAtMs: number;
  /** 用户自述「我是何时写下这条理由的」，与 createdAtMs 互为印证 */
  selfReportedWrittenAt: string | null;
  /** 可信锚：决定这条假设能不能计入归因权重 */
  anchor: HypothesisAnchor;
  /** 便捷标记，等价于 anchor === 'recall_only' */
  isBackfilled: boolean;
}

/** 收益分解 —— 每一项都必须可加总回实际收益，残差单列 */
export interface Attribution {
  /** 持有区间实际收益，% */
  totalReturnPct: number;
  /** 市场 β 贡献 */
  marketPct: number;
  /** 行业超额贡献 */
  sectorPct: number;
  /** 个股特质（含事件驱动，但不把事件量化拆开 —— 无法归因就说无法归因） */
  idiosyncraticPct: number;
  /** 执行偏差：实际成交 vs 理论收盘价成交的差额 */
  executionPct: number;
  /** 无法解释的残差，必须单列，不允许摊进其他项 */
  unexplainedPct: number;
  /** 计算口径与输入字段引用 */
  inputs: Record<string, { value: number | string | null; sourceEvidenceIds: string[] }>;
  /** 因数据缺失而降级的项 */
  degraded: { item: string; reason: string }[];
}

/** 行为偏差命中 —— 由规则算出，不是模型感觉 */
export interface BiasHit {
  /** 规则编码，如 `disposition_effect` */
  code: string;
  /** 中文名 */
  label: string;
  /** 命中的硬证据描述（含数字） */
  evidenceText: string;
  /** 支撑证据 id，可点开 */
  evidenceIds: string[];
  /** 判定规则的完整文字说明，供用户核验 */
  rule: string;
  /** 严重度 1-3 */
  severity: 1 | 2 | 3;
  /** 样本量；不足阈值时必须标 low_sample 而不是给结论 */
  sampleSize: number;
  /** 是否因样本不足而不下结论 */
  lowSample?: boolean;
}

/** 学习资产 —— 复盘产物，供「下一次决策」调用 */
export type AssetKind = 'checklist_item' | 'reminder_card' | 'error_dictionary';

export interface LearningAsset {
  id: string;
  kind: AssetKind;
  content: string;
  /** 触发条件：什么情境下该提醒 */
  trigger: string;
  /** 来自哪次复盘，可回溯 */
  fromSessionId: string;
  version: number;
  createdAtMs: number;
  /** 累计被使用次数与最近验证结果，用于判断这条清单是否有效 */
  usageCount: number;
  lastVerifiedAtMs: number | null;
}

/** 一次复盘会话 */
export interface ReviewSession {
  id: string;
  tradeId: string;
  /** 视角切换：买入时的我 / 卖出时的我 / 今天回看 */
  viewpoint: 'entry' | 'exit' | 'today';
  /** 该视角对应的判定截止时点 */
  cutoffMs: number;
  hypothesis: Hypothesis | null;
  attribution: Attribution | null;
  biasHits: BiasHit[];
  /** 数据完整度 0-1，用于给结论打置信度 */
  dataCompleteness: number;
  /** 缺失与降级清单 —— 必须显式展示 */
  gaps: { item: string; reason: string; impact: string }[];
  createdAtMs: number;
}
