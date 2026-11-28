/**
 * body-v2-prompts.ts — V2 正文模板常量的 re-export shim。
 *
 * 2026-11-28：常量本体已下沉到 shared/prompts/body-v2-prompts.ts（纯文本、零依赖，
 * services 层的 prompt-templates-default 需要与 engine 用同一份文本——此前两份漂移，
 * 用户在 PromptManager 编辑的是过期底稿并整体覆盖真模板）。
 * 引擎侧消费者继续从本文件导入，路径不变。
 */
export * from '@/shared/prompts/body-v2-prompts';
