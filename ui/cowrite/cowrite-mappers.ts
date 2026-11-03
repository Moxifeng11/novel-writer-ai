/**
 * cowrite-mappers.ts - 协同写作纯映射函数（C3 抽离）
 *
 * 从 CoWritingView 抽出的无状态映射/标签函数：联想类型到建议、方向/风格
 * 标签、空指标占位。这些函数不依赖视图实例，便于复用与单测。
 */

import { SuggestionRecord, SuggestionDirection, PlotCompletionMetrics } from '@/shared/types';
import { AssociationSuggestion } from '@/shared/co-writer-types';

/**
 * associationTypeToDirection 函数。
 * @param type - 类型
  * @returns SuggestionDirection 实例
 */
export function associationTypeToDirection(type: string): SuggestionDirection {
  if (type === "entity-action")
    return "action";
  if (type === "escalate")
    return "conflict";
  if (type === "foreshadow")
    return "foreshadow";
  if (type === "dialogue")
    return "dialogue";
  return "emotion";
}

/**
 * 获取关联标签。
 * @param type - 类型
 * @returns 文本结果
 */
export function getAssociationLabel(type: string): string {
  const labels: Record<string, string> = {
    "entity-action": "\u{1F3AD} \u89D2\u8272\u52A8\u4F5C",
    escalate: "\u26A1 \u51B2\u7A81\u5347\u7EA7",
    foreshadow: "\u{1F52E} \u4F0F\u7B14\u8054\u60F3",
    emotion: "\u{1FAC0} \u60C5\u7EEA\u5EF6\u5C55",
    dialogue: "\u{1F4AC} \u5BF9\u8BDD\u8865\u5168"
  };
  return labels[type] || "\u2728 \u8054\u60F3";
}

/**
 * associationToSuggestion 函数。
 * @param association - 关联
 * @param index - 索引
  * @returns SuggestionRecord 实例
 */
export function associationToSuggestion(association: AssociationSuggestion, index: number): SuggestionRecord {
  return {
    // 同毫秒生成两批建议时 Date.now()+index 会碰撞，导致 chosenSuggestionId 指错条目
    id: `assoc_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 8)}`,
    text: association.text,
    direction: associationTypeToDirection(association.type),
    style: "creative",
    temperature: 0.7,
    reasoning: `\u8054\u60F3\u8F93\u5165\uFF1A${getAssociationLabel(association.type)}\uFF0C\u7F6E\u4FE1\u5EA6 ${Math.round((association.confidence || 0) * 100)}%`,
    preview: association.preview
  };
}

/**
 * getDirectionLabel 函数。
 * @param direction - 方向
 * @returns 文本结果
 */
export function getDirectionLabel(direction: string): string {
  const labels: Record<string, string> = {
    action: "\u2694\uFE0F \u52A8\u4F5C",
    emotion: "\u{1FAC0} \u60C5\u7EEA",
    dialogue: "\u{1F4AC} \u5BF9\u8BDD",
    description: "\u{1F5BC}\uFE0F \u73AF\u5883",
    foreshadow: "\u{1F52E} \u4F0F\u7B14",
    conflict: "\u26A1 \u51B2\u7A81",
    resolution: "\u{1F3C1} \u6536\u675F",
    surprise: "\u{1F4A5} \u8F6C\u6298"
  };
  return labels[direction] || direction;
}

/**
 * 获取文风标签。
 * @param style - 文风
 * @returns 文本结果
 */
export function getStyleLabel(style: string): string {
  if (style === "creative")
    return "\u521B\u610F";
  if (style === "conservative")
    return "\u7A33\u5065";
  return "\u9ED8\u8BA4";
}

/**
 * emptyMetrics 函数。
  * @returns PlotCompletionMetrics 实例
 */
export function emptyMetrics(): PlotCompletionMetrics {
  return {
    sceneObjectivesMet: 0,
    characterArcsAdvanced: 0,
    foreshadowingSeeded: 0,
    emotionalArcProgress: 0,
    overallCompletion: 0,
    suggestionAdvice: "\u5C1A\u672A\u8BC4\u4F30\u3002\u63A5\u53D7\u4E00\u53E5\u5EFA\u8BAE\u540E\u4F1A\u81EA\u52A8\u66F4\u65B0\u3002",
    nextDirectionHints: ["action", "emotion", "dialogue"],
    evaluatedAt: Date.now()
  };
}
