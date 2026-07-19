/**
 * quality/rewrite-types.ts — 智能改写建议引擎类型定义（实时监控 V2 Task 4）
 *
 * 定义改写建议相关的数据模型、枚举和接口。
 */

// ============================================================
// 一、改写类型
// ============================================================

export type SuggestionType =
  | 'polish'      // 润色优化
  | 'expand'      // 扩写充实
  | 'condense'    // 缩写精简
  | 'rhythm'      // 节奏调整
  | 'character'   // 人物校准
  | 'logic';      // 逻辑补全

export const SUGGESTION_TYPES: readonly SuggestionType[] = [
  'polish',
  'expand',
  'condense',
  'rhythm',
  'character',
  'logic',
] as const;

export const SUGGESTION_TYPE_LABELS: Record<SuggestionType, string> = {
  polish: '润色优化',
  expand: '扩写充实',
  condense: '缩写精简',
  rhythm: '节奏调整',
  character: '人物校准',
  logic: '逻辑补全',
};

export const SUGGESTION_TYPE_DESC: Record<SuggestionType, string> = {
  polish: '优化用词和句式，提升语言质感',
  expand: '增加细节描写和心理活动，让内容更丰满',
  condense: '精简冗余描述，提高信息密度',
  rhythm: '调整句子长短和段落节奏，改善阅读体验',
  character: '校准人物行为和对话，使其符合人设',
  logic: '补充因果链和过渡，增强情节连贯性',
};

// ============================================================
// 二、触发场景
// ============================================================

export type TriggerType =
  | 'cursorHover'    // 光标停留触发
  | 'selection'      // 选中文本触发
  | 'issueClick'     // 点击预警项触发
  | 'lowScore';      // 低分配方触发

export const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  cursorHover: '光标停留',
  selection: '选中文本',
  issueClick: '预警项点击',
  lowScore: '低分配方',
};

// ============================================================
// 三、改写建议实体
// ============================================================

export interface RewriteSuggestion {
  /** 建议唯一 ID */
  id: string;
  /** 改写类型 */
  type: SuggestionType;
  /** 建议标题 */
  title: string;
  /** 改写后的文本 */
  rewrittenText: string;
  /** 原始文本（用于对比） */
  originalText: string;
  /** 改写说明 */
  description: string;
  /** 改动位置 */
  location: {
    start: number;
    end: number;
  };
  /** 置信度 0-1 */
  confidence: number;
  /** 预估改善维度 */
  improvedDimensions?: string[];
}

export interface RewriteResult {
  /** 生成请求 ID */
  requestId: string;
  /** 触发类型 */
  trigger: TriggerType;
  /** 改写类型 */
  suggestionType: SuggestionType;
  /** 建议列表（2-3 个方案） */
  suggestions: RewriteSuggestion[];
  /** 是否命中降级（AI 失败时使用规则建议） */
  isFallback: boolean;
  /** 降级说明 */
  fallbackReason?: string;
  /** 生成耗时 */
  durationMs: number;
  /** 生成时间戳 */
  timestamp: number;
}

// ============================================================
// 四、生成上下文
// ============================================================

export interface RewriteContext {
  /** 项目 ID */
  projectId: string;
  /** 章节 ID */
  chapterId: string;
  /** 待改写的文本 */
  text: string;
  /** 文本在全文中的起始位置 */
  textStartOffset: number;
  /** 全文内容（用于上下文理解） */
  fullText?: string;
  /** 改写类型（可选，不指定则自动判断） */
  suggestionType?: SuggestionType;
  /** 触发场景 */
  trigger: TriggerType;
  /** 质量评分结果（用于低分配方触发） */
  qualityScore?: {
    dimension: string;
    score: number;
  };
  /** 偏离预警项（用于预警点击触发） */
  deviationIssue?: {
    type: string;
    description: string;
    suggestion?: string;
  };
  /** 人物设定信息 */
  characterInfos?: Array<{
    name: string;
    personality?: string;
    appearance?: string;
  }>;
  /** 章节大纲 */
  chapterOutline?: string;
  /** 风格指纹 */
  styleFingerprint?: Record<string, number>;
}

// ============================================================
// 五、引擎选项
// ============================================================

export interface RewriteSuggestionEngineOptions {
  /** AI 引擎调用器（注入后使用 AI 生成，否则使用规则建议） */
  aiEngine?: {
    callAI(system: string, user: string, options?: { signal?: AbortSignal }): Promise<{ content: string }>;
  };
  /** 最大方案数 */
  maxSuggestions?: number;
  /** 缓存最大条目数 */
  cacheSize?: number;
  /** 缓存存活时间（毫秒） */
  cacheTtlMs?: number;
}

// ============================================================
// 六、流式生成事件
// ============================================================

export type RewriteStreamEventType =
  | 'start'
  | 'progress'
  | 'suggestion'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface RewriteStreamEvent {
  type: RewriteStreamEventType;
  /** 当前方案索引 */
  suggestionIndex?: number;
  /** 流式文本片段 */
  chunk?: string;
  /** 完整建议（suggestion 事件时） */
  suggestion?: RewriteSuggestion;
  /** 错误信息 */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}

export type RewriteStreamHandler = (event: RewriteStreamEvent) => void;
