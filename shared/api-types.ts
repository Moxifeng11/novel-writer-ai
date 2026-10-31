/**
 * api-types.ts — AI 调用结果类型（shared 层）
 *
 * 定义从 engine 层下沉：`shared/api-response-utils.ts` 等 shared 模块需要读取
 * `APIResponse.content`，原先只能反向 `import type` engine/ai-engine。
 * 类型归属 shared 后，engine 与 shared 都从这里引用；`engine/ai-engine` 保留再导出。
 */
export interface APIResponse {
    content: string;
    error?: string;
    usage?: {
        prompt: number;
        completion: number;
        total: number;
    };
    finishReason?: 'stop' | 'length' | 'error' | 'aborted';
}
