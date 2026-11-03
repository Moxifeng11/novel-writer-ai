/**
 * engine/prompts/writing-rules.ts（兼容 re-export）
 *
 * 规则正文已下沉到 `shared/writing-rules.ts`：`services/rules-registry.ts` 需要读取它，
 * 而 services 层只允许依赖 shared（原本直接 import 本文件会破坏分层门禁）。
 * 引擎侧仍从这里取 `WRITING_RULES`，导入路径不变。
 */
export { WRITING_RULES, WRITING_RULES_BUILTIN_VERSION } from '@/shared/writing-rules';
