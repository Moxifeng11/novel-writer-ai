/**
 * quality/rewrite-prompts.ts — 智能改写建议 Prompt 模板（实时监控 V2 Task 4）
 *
 * 为 6 种改写类型提供 AI 提示词模板，支持多方案生成。
 */

import type { SuggestionType } from './rewrite-types';

// ============================================================
// 一、系统提示词基础
// ============================================================

const SYSTEM_BASE = `你是一位资深小说编辑，擅长精准改写和润色中文网络小说。
你的任务是根据指定的改写类型，为作者提供高质量的改写建议。

【核心原则】
1. 保持原文的核心情节和人物意图不变
2. 改写后的文本必须与原文风格一致
3. 只改写指定段落，不扩展或缩减情节
4. 输出必须是可直接替换原文的完整段落
5. 每个方案要有明显差异，给作者不同选择

【输出格式——严格遵循】
以 JSON 数组格式返回，每个元素包含：
- title: 方案标题（简短描述改动重点）
- rewrittenText: 改写后的完整文本
- description: 改写的具体说明（改了什么、为什么）
- confidence: 置信度（0.0-1.0）

不要输出任何解释性文字，只返回 JSON。`;

// ============================================================
// 二、各类型系统提示词
// ============================================================

const TYPE_SYSTEM_PROMPTS: Record<SuggestionType, string> = {
  polish: `${SYSTEM_BASE}

【润色优化】
聚焦语言质感的提升：
- 替换平庸词汇为更精准、更有画面感的表达
- 优化句式节奏，避免重复句式
- 增强修辞效果（比喻、拟人、通感等）
- 保持口语化/书面化的原有风格`,

  expand: `${SYSTEM_BASE}

【扩写充实】
聚焦内容丰满度的提升：
- 增加感官描写（视觉、听觉、嗅觉、触觉、味觉）
- 补充人物的心理活动和内心独白
- 添加环境细节和氛围渲染
- 扩写幅度控制在原文的 1.2-1.8 倍`,

  condense: `${SYSTEM_BASE}

【缩写精简】
聚焦信息密度的提升：
- 删除冗余的形容词和副词
- 合并重复表达
- 将多个短句合并为精炼长句
- 保留核心信息，删除赘述
- 缩写幅度控制在原文的 0.5-0.8 倍`,

  rhythm: `${SYSTEM_BASE}

【节奏调整】
聚焦叙事节奏的优化：
- 快节奏场景：多用短句、动作动词，减少描写
- 慢节奏场景：增加环境描写和心理描写
- 调整段落长度，制造呼吸感
- 高潮前适当加快节奏，高潮后适当放缓`,

  character: `${SYSTEM_BASE}

【人物校准】
聚焦人物一致性的校准：
- 确保人物行为符合其性格设定
- 对话风格与人物身份匹配
- 人物反应符合其过往经历和能力
- 若人物有设定资料，严格遵循设定`,

  logic: `${SYSTEM_BASE}

【逻辑补全】
聚焦情节连贯性的增强：
- 补充缺失的因果过渡
- 增加时间和空间转换的衔接
- 确保前后文逻辑一致
- 补充必要的背景信息`,
};

// ============================================================
// 三、用户提示词构建
// ============================================================

export interface RewritePromptVars {
  /** 待改写的原文 */
  text: string;
  /** 改写类型 */
  type: SuggestionType;
  /** 前文上下文 */
  precedingContext?: string;
  /** 后文上下文 */
  followingContext?: string;
  /** 人物设定 */
  characterInfos?: string;
  /** 章节大纲 */
  chapterOutline?: string;
  /** 风格指纹描述 */
  styleDescription?: string;
  /** 质量评分维度（低分配方触发时） */
  lowScoreDimension?: string;
  /** 偏离预警描述（预警点击触发时） */
  deviationDescription?: string;
}

/**
 * 构建系统提示词
 */
export function buildSystemPrompt(type: SuggestionType): string {
  return TYPE_SYSTEM_PROMPTS[type] || SYSTEM_BASE;
}

/**
 * 构建用户提示词
 */
export function buildUserPrompt(vars: RewritePromptVars): string {
  const sections: string[] = [];

  // 上下文部分
  if (vars.precedingContext) {
    sections.push(`【前文上下文】\n${vars.precedingContext.slice(-500)}`);
  }

  // 待改写文本
  sections.push(`【待改写的原文】\n${vars.text}`);

  // 后文上下文
  if (vars.followingContext) {
    sections.push(`【后文上下文】\n${vars.followingContext.slice(0, 500)}`);
  }

  // 辅助信息
  const extras: string[] = [];
  if (vars.chapterOutline) {
    extras.push(`章节大纲：${vars.chapterOutline.slice(0, 300)}`);
  }
  if (vars.characterInfos) {
    extras.push(`人物设定：${vars.characterInfos.slice(0, 300)}`);
  }
  if (vars.styleDescription) {
    extras.push(`风格要求：${vars.styleDescription}`);
  }
  if (vars.lowScoreDimension) {
    extras.push(`需重点改善：${vars.lowScoreDimension}`);
  }
  if (vars.deviationDescription) {
    extras.push(`偏离问题：${vars.deviationDescription}`);
  }

  if (extras.length > 0) {
    sections.push(`【辅助信息】\n${extras.join('\n')}`);
  }

  // 输出要求
  sections.push(`【输出要求】
请提供 2-3 个改写方案，每个方案要有不同的侧重点。
以 JSON 数组格式返回：
[
  {
    "title": "方案标题",
    "rewrittenText": "改写后的完整文本",
    "description": "改写说明",
    "confidence": 0.85
  }
]`);

  return sections.join('\n\n');
}

// ============================================================
// 四、自动判断改写类型的 Prompt
// ============================================================

export const AUTO_TYPE_DETECTION_SYSTEM = `你是一位小说分析助手。根据提供的文本和上下文，判断最适合的改写类型。

可选类型：
- polish: 文本语言平庸，需要润色提升
- expand: 内容过于简略，需要增加细节
- condense: 内容冗长啰嗦，需要精简
- rhythm: 节奏单调，需要调整叙事节奏
- character: 人物行为或对话有问题
- logic: 逻辑跳跃或缺失过渡

只返回一个类型代码，不要解释。`;

export function buildAutoTypePrompt(text: string, context?: string): string {
  const sections = [`【待分析文本】\n${text}`];
  if (context) {
    sections.push(`【上下文】\n${context.slice(0, 500)}`);
  }
  sections.push(`请判断最适合的改写类型（只返回类型代码）：`);
  return sections.join('\n\n');
}

// ============================================================
// 五、响应解析辅助
// ============================================================

/**
 * 从 AI 响应中提取 JSON
 */
export function extractJSONFromResponse(response: string): unknown[] {
  const cleaned = response
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.suggestions && Array.isArray(parsed.suggestions)) return parsed.suggestions;
    if (parsed.rewrites && Array.isArray(parsed.rewrites)) return parsed.rewrites;
    return [];
  } catch {
    // 尝试从文本中提取 JSON 数组
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return [];
      }
    }
    return [];
  }
}
