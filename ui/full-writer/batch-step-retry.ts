/**
 * batch-step-retry.ts — 批量 N 章的单步失败重试策略（纯函数，叶子模块）
 *
 * 独立成文件的原因：`batch-pipeline-runner.ts` 会间接拉起 `main.ts` 依赖，
 * 单测直接导入会报 `Cannot find module 'obsidian'`；策略判定必须可独立测试。
 */

/** 单步最多尝试次数（首次 + 1 次重试）：本地模型偶发空输出，整章判失败代价过高 */
export const BATCH_STEP_MAX_ATTEMPTS = 2;

/**
 * 步骤失败后是否需要重试：取消不重试，达到上限不重试
 *
 * @param params - 参数集合
 * @returns 是否成功
 */
export function shouldRetryBatchStep(params: {
    produced: boolean;
    cancelled: boolean;
    attempts: number;
    maxAttempts?: number;
}): boolean {
    if (params.produced || params.cancelled) return false;
    return params.attempts < (params.maxAttempts ?? BATCH_STEP_MAX_ATTEMPTS);
}
