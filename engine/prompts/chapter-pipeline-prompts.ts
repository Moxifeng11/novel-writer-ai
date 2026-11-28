/**
 * chapter-pipeline-prompts.ts — 9 步流水线 V1 模板常量 的 re-export shim。
 *
 * 2026-11-28：常量本体已下沉 shared/prompts/chapter-pipeline-prompts.ts（纯文本零依赖，
 * services 层 prompt-templates-default 需与引擎用同一份文本——实测 5 个
 * 步骤默认模板全部漂移，用户在 PromptManager 编辑会从过期底稿整体覆盖
 * 真模板）。引擎侧消费者继续从本文件导入，路径不变。
 */
export * from '@/shared/prompts/chapter-pipeline-prompts';
